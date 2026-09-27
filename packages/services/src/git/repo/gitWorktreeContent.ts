import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
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

/** 递归进入已初始化子模块的最大层数；更深的按无法确认处理。 */
const MAX_SUBMODULE_DEPTH = 8;

/**
 * 未初始化子模块目录里是否有文件：按 `.gitmodules` 中的路径逐一检查，已初始化的（目录里有 `.git`）递归进入其
 * `.gitmodules`。路径用 `git config -z` 读取（记录以 NUL 分隔），含换行的路径也不会被截断。
 */
async function findUninitializedSubmoduleContent(
  commandProvider: GitCommandProvider,
  root: string,
  depth: number,
): Promise<boolean | "unknown"> {
  const config = await commandProvider.run({
    cwd: root,
    args: ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  // 没有 .gitmodules 或其中没有路径时以 1 退出且没有输出。
  if (config.exitCode === 1 && config.stdout.length === 0) return false;
  if (config.exitCode !== 0 || config.timedOut || config.outputTruncated) return "unknown";
  for (const record of config.stdout.split("\0")) {
    const separator = record.indexOf("\n");
    const path = separator < 0 ? "" : record.slice(separator + 1);
    // git 不接受绝对路径或含 `..` 的子模块路径；这类记录不指向 worktree 内的目录。
    if (path.length === 0 || isAbsolute(path) || path.split("/").includes("..")) continue;
    const dir = join(root, ...path.split("/"));
    let children: string[];
    try {
      children = await readdir(dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // 不存在或不是目录时没有内容；其它读取错误无法确认。
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      return "unknown";
    }
    if (children.length === 0) continue;
    if (!children.includes(".git")) return true;
    if (depth >= MAX_SUBMODULE_DEPTH) return "unknown";
    const nested = await findUninitializedSubmoduleContent(commandProvider, dir, depth + 1);
    if (nested !== false) return nested;
  }
  return false;
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
  // 里面的本地文件会被不带 --force 的删除直接删掉，没有任何确认。按行解析 `git submodule status` 时，含换行的路径
  // 会被截断，检查的是不存在的前缀。
  // 修复依据：按 `.gitmodules`（NUL 分隔读取）检查子模块目录，目录非空且未初始化时按有未提交改动处理；
  // `git submodule status` 只用来发现无法处理的情况（如 index 中的 gitlink 在 .gitmodules 里没有对应项时它会失败）。
  const submodules = await run(["submodule", "status", "--recursive"]);
  const uninitializedContent = await findUninitializedSubmoduleContent(
    commandProvider,
    worktreePath,
    0,
  );
  const uninitializedWithContent = uninitializedContent === true;
  const lines = `${status.stdout}\n${submoduleStatus.stdout}`
    .split("\n")
    .filter((line) => line.length > 0);
  // 修复原因：status 失败、超时或输出超限时只记为“有未提交改动”、被忽略的文件记为没有；用户只同意丢弃改动后，
  // 删除时同样读取失败即会带 --force 删掉从未提示过的被忽略文件（如 .env）。
  // 修复依据：读不出状态时无法区分两类内容，两者都按存在处理并标出 statusUnknown，删除前须同时同意两类内容。
  const statusUnknown =
    uninitializedContent === "unknown" ||
    [status, submoduleStatus, submodules].some(
      (result) => result.exitCode !== 0 || result.timedOut || result.outputTruncated,
    );
  return {
    hasUncommittedChanges:
      statusUnknown || uninitializedWithContent || lines.some((line) => !line.startsWith("!! ")),
    hasIgnoredFiles: statusUnknown || lines.some((line) => line.startsWith("!! ")),
    statusUnknown,
  };
}
