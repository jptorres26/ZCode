/**
 * 在仓库外创建新 worktree 并检出新分支。规范：docs/specs/git-worktree-task.md
 */
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { GitCreateWorktreeResult } from "@zcode/shared";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS, DEFAULT_GIT_OUTPUT_BYTES } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { parseGitBranchMutationIssues } from "./gitCliHelpers.js";

/** worktree add 会检出整棵树，大仓库远超普通 Git 命令的 15s。 */
const GIT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000;
const MAX_WORKTREE_NAME_ATTEMPTS = 99;

export function toWorktreeSlug(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return slug || "worktree";
}

/** 同一仓库的 worktree 放在同一目录下；哈希区分同名仓库。 */
export function getWorktreeContainerDir(worktreesRootDir: string, repoRoot: string): string {
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 8);
  return join(worktreesRootDir, `${toWorktreeSlug(basename(repoRoot))}-${hash}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function pickFreeWorktreePath(containerDir: string, slug: string): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_WORKTREE_NAME_ATTEMPTS; attempt += 1) {
    const candidate = join(containerDir, attempt === 1 ? slug : `${slug}-${attempt}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  return null;
}

export async function addGitWorktree(context: {
  commandProvider: GitCommandProvider;
  repoRoot: string;
  /** `.` 表示仓库根，否则为 `/` 分隔的子目录。 */
  workspaceInRepoPath: string;
  branchName: string;
  worktreesRootDir: string;
}): Promise<GitCreateWorktreeResult> {
  const { branchName } = context;
  // 修复原因：用户手动删除 worktree 目录后，Git 仍登记着它；同名目录再次 add 会报
  // “missing but already registered worktree”，界面上无法自行修复。
  // 修复依据：add 前执行 prune，只清理目录已不存在的登记项，不影响仍存在的 worktree。
  await context.commandProvider.run({
    cwd: context.repoRoot,
    args: ["worktree", "prune"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  });
  const containerDir = getWorktreeContainerDir(context.worktreesRootDir, context.repoRoot);
  await mkdir(containerDir, { recursive: true });
  const worktreePath = await pickFreeWorktreePath(containerDir, toWorktreeSlug(branchName));
  if (!worktreePath) {
    return {
      ok: false,
      branchName,
      issues: [{ code: "unknown", message: "No free worktree directory is left for this branch." }],
    };
  }

  // 分支名已经过 check-ref-format 校验，路径为绝对路径，都不会被当成选项解析。
  const result = await context.commandProvider.run({
    cwd: context.repoRoot,
    args: ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
    timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return { ok: false, branchName, issues: parseGitBranchMutationIssues(result) };
  }

  // 修复原因：原 workspace 若是 HEAD 中不存在的子目录（未跟踪、被忽略或新建），映射出的路径在新 worktree
  // 里并不存在，打开后 cwd、Git 与文件树都会失败。修复依据：映射路径不存在时回退到 worktree 根目录。
  const mappedWorkspacePath =
    context.workspaceInRepoPath === "."
      ? worktreePath
      : join(worktreePath, ...context.workspaceInRepoPath.split("/"));
  const workspacePath = (await pathExists(mappedWorkspacePath))
    ? mappedWorkspacePath
    : worktreePath;
  return { ok: true, branchName, worktreePath, workspacePath };
}
