import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS, DEFAULT_GIT_OUTPUT_BYTES } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";

/** 删除 worktree 会一并丢失的内容分类。规范：docs/specs/git-worktree-task.md */
interface WorktreeContent {
  /** 有未提交改动（含未跟踪文件，以及未初始化子模块目录里的文件）。 */
  hasUncommittedChanges: boolean;
  /** 有被 Git 忽略的文件（含已初始化子模块内的）。 */
  hasIgnoredFiles: boolean;
  /** 读不出状态：上面两项都按存在处理。 */
  statusUnknown: boolean;
}

export async function readWorktreeContent(
  commandProvider: GitCommandProvider,
  worktreePath: string,
): Promise<WorktreeContent> {
  const run = (args: string[]) =>
    commandProvider.run({
      cwd: worktreePath,
      args,
      timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
    });
  // 修复原因：只有被忽略的文件（如 .env、安装的依赖）时 status 没有输出，界面跳过“永久丢失”确认，
  // 而 git worktree remove 会连同这些文件一起删除。修复依据：带 --ignored 读取，被忽略的条目（`!! `）单独报告。
  const status = await run(["status", "--porcelain", "--untracked-files=normal", "--ignored"]);
  // 修复原因：顶层的 status --ignored 不进入子模块，已初始化子模块里被忽略的文件（如 sm/cache）不会报告；
  // 用户只同意丢弃未提交改动时，带 --force 的删除会连同它们一起删掉。
  // 修复依据：在每个已初始化的子模块（递归）里执行同样的 status，结果与顶层合并。
  const submoduleStatus = await run([
    "submodule",
    "foreach",
    "--quiet",
    "--recursive",
    "git status --porcelain --untracked-files=normal --ignored",
  ]);
  // 修复原因：未初始化（或已 deinit）的子模块目录不被 foreach 访问，顶层 status 也不报告 gitlink 目录下的文件；
  // 里面的本地文件会被不带 --force 的删除直接删掉，没有任何确认。
  // 修复依据：`git submodule status` 以 `-` 标出未初始化的子模块，这些目录非空时按有未提交改动处理。
  const submodules = await run(["submodule", "status", "--recursive"]);
  const uninitializedPaths = submodules.stdout
    .split("\n")
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(line.indexOf(" ") + 1))
    .filter((path) => path.length > 0);
  const uninitializedWithContent = (
    await Promise.all(
      uninitializedPaths.map((path) =>
        readdir(join(worktreePath, ...path.split("/"))).then(
          (children) => children.length > 0,
          // 不存在或不是目录时没有内容；其它读取错误无法确认，按有内容处理。
          (error: NodeJS.ErrnoException) => error.code !== "ENOENT" && error.code !== "ENOTDIR",
        ),
      ),
    )
  ).some(Boolean);
  const lines = `${status.stdout}\n${submoduleStatus.stdout}`
    .split("\n")
    .filter((line) => line.length > 0);
  // 修复原因：status 失败、超时或输出超限时只记为“有未提交改动”、被忽略的文件记为没有；用户只同意丢弃改动后，
  // 删除时同样读取失败即会带 --force 删掉从未提示过的被忽略文件（如 .env）。
  // 修复依据：读不出状态时无法区分两类内容，两者都按存在处理并标出 statusUnknown，删除前须同时同意两类内容。
  const statusUnknown = [status, submoduleStatus, submodules].some(
    (result) => result.exitCode !== 0 || result.timedOut || result.outputTruncated,
  );
  return {
    hasUncommittedChanges:
      statusUnknown || uninitializedWithContent || lines.some((line) => !line.startsWith("!! ")),
    hasIgnoredFiles: statusUnknown || lines.some((line) => line.startsWith("!! ")),
    statusUnknown,
  };
}
