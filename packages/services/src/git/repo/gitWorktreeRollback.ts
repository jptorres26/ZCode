import { DEFAULT_GIT_COMMAND_TIMEOUT_MS, DEFAULT_GIT_OUTPUT_BYTES } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { parseWorktreeList, realpathOrSelf } from "./gitWorktreeList.js";

// 新建 worktree 失败后的回滚。规范：docs/specs/git-worktree-task.md

/** 引用查询结果：找到、确认不存在，或无法判断（超时、输出超限、其它错误）。 */
type CommitLookup = { kind: "found"; oid: string } | { kind: "missing" } | { kind: "unknown" };

export async function readCommit(
  context: { commandProvider: GitCommandProvider; repoRoot: string },
  ref: string,
): Promise<CommitLookup> {
  const result = await context.commandProvider.run({
    cwd: context.repoRoot,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  });
  const oid = result.stdout.trim();
  if (result.timedOut || result.outputTruncated) return { kind: "unknown" };
  if (result.exitCode === 0 && oid.length > 0) return { kind: "found", oid };
  // --verify --quiet：引用不存在时以 1 退出且没有输出。
  if (result.exitCode === 1 && oid.length === 0) return { kind: "missing" };
  return { kind: "unknown" };
}

/**
 * 回滚失败的 `git worktree add`，只清理这次尝试新建的内容：目标目录此前不存在（pickFreeWorktreePath），仍登记时
 * 连同锁定一并删除；分支此前不存在（调用方判断），没有被任何 worktree 检出时按起点提交删除（update-ref 核对旧值，
 * 期间被移动过则不删）。尽力而为，任何一步失败都停止，保留剩余内容。
 */
export async function rollBackFailedWorktreeAdd(context: {
  commandProvider: GitCommandProvider;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
}): Promise<void> {
  const run = (args: string[]) =>
    context.commandProvider.run({
      cwd: context.repoRoot,
      args,
      timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
    });
  const listWorktrees = async () => {
    const result = await run(["worktree", "list", "--porcelain"]);
    if (result.exitCode !== 0) return null;
    return await Promise.all(
      parseWorktreeList(result.stdout).map(async (entry) => ({
        ...entry,
        resolved: await realpathOrSelf(entry.path),
      })),
    );
  };
  await run(["worktree", "prune"]);
  const target = await realpathOrSelf(context.worktreePath);
  let entries = await listWorktrees();
  if (entries?.some((entry) => entry.resolved === target)) {
    // 检出被中断时 git 会把新 worktree 标为锁定（initializing），需要两次 --force。
    await run(["worktree", "remove", "--force", "--force", context.worktreePath]);
    entries = await listWorktrees();
  }
  if (!entries || entries.some((entry) => entry.branchName === context.branchName)) return;
  await run(["update-ref", "-d", `refs/heads/${context.branchName}`, context.baseCommit]);
}
