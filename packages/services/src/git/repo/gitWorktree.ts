/**
 * 在仓库外创建新 worktree 并检出新分支。规范：docs/specs/git-worktree-task.md
 */
import { createHash } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type {
  GitCreateWorktreeResult,
  GitManagedWorktree,
  GitRemoveWorktreeResult,
} from "@zcode/shared";
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

interface WorktreeListEntry {
  path: string;
  branchName: string | null;
}

function parseWorktreeList(stdout: string): WorktreeListEntry[] {
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

async function realpathOrSelf(path: string): Promise<string> {
  return await realpath(path).catch(() => path);
}

function isInsideDir(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

/**
 * 只有 ZCode 创建的链接 worktree（位于 worktreesRootDir 下，且不是主检出）才返回信息；
 * 用户自己创建的仓库或 worktree 返回 null，不提供删除。规范：docs/specs/git-worktree-task.md
 */
export async function readManagedWorktree(context: {
  commandProvider: GitCommandProvider;
  worktreeRoot: string;
  worktreesRootDir: string;
}): Promise<GitManagedWorktree | null> {
  const [worktreeRoot, worktreesRootDir] = await Promise.all([
    realpathOrSelf(context.worktreeRoot),
    realpathOrSelf(context.worktreesRootDir),
  ]);
  if (!isInsideDir(worktreeRoot, worktreesRootDir)) {
    return null;
  }
  const result = await context.commandProvider.run({
    cwd: worktreeRoot,
    args: ["worktree", "list", "--porcelain"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const entries = parseWorktreeList(result.stdout);
  const main = entries[0];
  const resolvedEntries = await Promise.all(
    entries.map(async (entry) => ({ ...entry, resolved: await realpathOrSelf(entry.path) })),
  );
  const current = resolvedEntries.find((entry) => entry.resolved === worktreeRoot);
  if (!main || !current || current.path === main.path) {
    return null;
  }
  return {
    worktreePath: current.path,
    mainWorktreePath: main.path,
    branchName: current.branchName,
  };
}

export async function removeManagedWorktree(context: {
  commandProvider: GitCommandProvider;
  worktree: GitManagedWorktree | null;
  force: boolean;
}): Promise<GitRemoveWorktreeResult> {
  const { worktree } = context;
  if (!worktree) {
    return { ok: false, reason: "not-managed" };
  }
  if (!context.force) {
    const status = await context.commandProvider.run({
      cwd: worktree.worktreePath,
      args: ["status", "--porcelain", "--untracked-files=normal"],
      timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
    });
    if (status.exitCode !== 0 || status.stdout.trim().length > 0) {
      return { ok: false, reason: "dirty" };
    }
  }
  // 在主检出中执行，避免在待删除目录内运行；路径为 git 自身给出的绝对路径，不会被当成选项。
  const result = await context.commandProvider.run({
    cwd: worktree.mainWorktreePath,
    args: context.force
      ? ["worktree", "remove", "--force", worktree.worktreePath]
      : ["worktree", "remove", worktree.worktreePath],
    timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return { ok: false, reason: "failed", detail: result.stderr.trim() || result.stdout.trim() };
  }
  return { ok: true, mainWorktreePath: worktree.mainWorktreePath, branchName: worktree.branchName };
}
