import { realpath } from "node:fs/promises";

/** `git worktree list --porcelain` 的条目与路径比较工具（gitWorktree 与其回滚共用）。 */
interface WorktreeListEntry {
  path: string;
  branchName: string | null;
}

export function parseWorktreeList(stdout: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  for (const block of stdout.replace(/\r\n/g, "\n").split("\n\n")) {
    let path: string | null = null;
    let branchName: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) {
        branchName = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
    if (path) entries.push({ path, branchName });
  }
  return entries;
}

export async function realpathOrSelf(path: string): Promise<string> {
  return await realpath(path).catch(() => path);
}
