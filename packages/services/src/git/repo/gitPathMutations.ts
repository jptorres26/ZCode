import {
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_OUTPUT_BYTES,
  normalizeGitPath,
} from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { ensureGitCommandSucceeded, parseStatusPorcelain } from "./gitCliHelpers.js";
import type { GitStatusEntry } from "./gitCliTypes.js";

/**
 * Review 面板按路径取消暂存 / 丢弃的执行计划。
 * 规范：docs/specs/git-review-pane-file-actions.md
 */
export interface GitPathMutationPlan {
  /** 交给 git restore / git rm 的已跟踪路径（按需包含重命名原路径）。 */
  trackedPaths: string[];
  /** 交给 git clean 的未跟踪路径。 */
  untrackedPaths: string[];
  /** 存在未解决冲突的请求路径。 */
  conflictedPaths: string[];
}

export interface GitPathMutationContext {
  commandProvider: GitCommandProvider;
  repoRoot: string;
  /** 已规范化、去重且非空的仓库相对路径。 */
  repoPaths: string[];
}

const GIT_DISCARD_CONFLICTED_ERROR = "Cannot discard paths with unresolved conflicts.";
const GIT_DISCARD_NESTED_REPOSITORY_ERROR =
  "Some untracked folders were not fully deleted because they contain a nested Git repository:";

function toDirectoryPrefix(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function entryMatchesRequestedPath(entry: GitStatusEntry, requestedPath: string): boolean {
  if (entry.path === requestedPath || entry.originalPath === requestedPath) {
    return true;
  }
  // 请求的是目录：状态里列出的是目录下的文件，或折叠后的 `dir/`。
  if (entry.path.startsWith(toDirectoryPrefix(requestedPath))) {
    return true;
  }
  // 请求的是折叠未跟踪目录（`dir/`）内部的文件。
  return entry.isUntracked && entry.path.endsWith("/") && requestedPath.startsWith(entry.path);
}

const GIT_DISCARD_REPLACED_DELETION_ERROR =
  "Cannot discard a staged deletion while an untracked file exists at the same path. Move or delete it first:";

/** 只有已暂存删除（`D.`）的条目：index 中已没有该路径，工作区中同一路径上的内容是未跟踪的。 */
function isStagedDeletionOnly(entry: GitStatusEntry): boolean {
  return !entry.isUntracked && entry.x === "D" && (entry.y === null || entry.y === ".");
}

/**
 * 请求路径中，已暂存删除、而工作区同一路径上又有未跟踪内容（重新创建的文件或目录）的路径。
 * 修复原因：丢弃 staged 的删除用 `git restore --source=HEAD --staged --worktree` 恢复 HEAD 版本，
 * 会静默覆盖用户在该路径上重新创建的文件；确认文案把删除条目计为不删除任何文件，不会提示这一点。
 * 修复依据：出现这种冲突时拒绝整个丢弃并列出这些路径，由用户先移走或删除重新创建的内容。
 */
function findReplacedStagedDeletions(
  entries: readonly GitStatusEntry[],
  requestedPaths: readonly string[],
): string[] {
  const untracked = entries
    .filter((entry) => entry.isUntracked)
    .map((entry) => entry.path.replace(/\/$/, ""));
  return entries
    .filter(
      (entry) =>
        isStagedDeletionOnly(entry) &&
        requestedPaths.some((path) => entryMatchesRequestedPath(entry, path)) &&
        untracked.some((path) => entry.path === path || entry.path.startsWith(`${path}/`)),
    )
    .map((entry) => entry.path);
}

function pushUnique(target: string[], seen: Set<string>, path: string): void {
  if (!seen.has(path)) {
    seen.add(path);
    target.push(path);
  }
}

/**
 * 纯函数：根据按请求路径裁剪的 `git status` 条目，决定每个路径交给哪条 git 命令。
 * 状态里不存在的路径（已干净、被忽略或已删除，常见于 UI 快照过期）没有可操作的变更，
 * 直接跳过，使重复点击和过期请求保持幂等。
 */
export function planGitPathMutation(
  entries: readonly GitStatusEntry[],
  requestedPaths: readonly string[],
  options: { includeRenameOrigins: boolean },
): GitPathMutationPlan {
  const trackedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  const conflictedPaths: string[] = [];
  const trackedSeen = new Set<string>();
  const untrackedSeen = new Set<string>();
  const conflictedSeen = new Set<string>();

  for (const requestedPath of requestedPaths) {
    const matched = entries.filter((entry) => entryMatchesRequestedPath(entry, requestedPath));
    if (matched.some((entry) => entry.isConflicted)) {
      pushUnique(conflictedPaths, conflictedSeen, requestedPath);
    }
    const trackedMatches = matched.filter((entry) => !entry.isUntracked);
    if (trackedMatches.length > 0) {
      pushUnique(trackedPaths, trackedSeen, requestedPath);
    }
    if (options.includeRenameOrigins) {
      for (const match of trackedMatches) {
        if (match.originalPath) {
          pushUnique(trackedPaths, trackedSeen, match.originalPath);
        }
        if (match.originalPath === requestedPath) {
          pushUnique(trackedPaths, trackedSeen, match.path);
        }
      }
    }
    if (matched.some((entry) => entry.isUntracked)) {
      pushUnique(untrackedPaths, untrackedSeen, requestedPath);
    }
  }

  return { trackedPaths, untrackedPaths, conflictedPaths };
}

async function runGit(context: GitPathMutationContext, label: string, args: string[]) {
  const result = await context.commandProvider.run({
    cwd: context.repoRoot,
    args,
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  return ensureGitCommandSucceeded(label, result);
}

/** 解析 `git diff --cached --name-status -z -M --diff-filter=R` 输出为已暂存重命名条目。 */
export function parseStagedRenameEntries(stdout: string): GitStatusEntry[] {
  const records = stdout.split("\0").filter((record) => record.length > 0);
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index + 2 < records.length; index += 3) {
    const status = records[index]!;
    if (!status.startsWith("R")) {
      continue;
    }
    entries.push({
      path: normalizeGitPath(records[index + 2]!),
      originalPath: normalizeGitPath(records[index + 1]!),
      kind: "renamed",
      x: "R",
      y: ".",
      isUntracked: false,
      isConflicted: false,
    });
  }
  return entries;
}

async function readStagedRenameEntries(context: GitPathMutationContext): Promise<GitStatusEntry[]> {
  // 按路径裁剪的 status 看不到路径集合之外的另一端，重命名会退化成单独的 A / D。
  // 重命名对只能从不裁剪的 index 对比中读取；--diff-filter=R 只输出重命名，体积很小。
  const renames = await runGit(context, "git diff --cached renames", [
    "diff",
    "--cached",
    "--name-status",
    "-z",
    "-M",
    "--diff-filter=R",
  ]);
  return parseStagedRenameEntries(renames.stdout);
}

/** 返回请求路径中已暂存重命名的原路径（供按路径提交时一并提交原路径的删除）。 */
export async function readStagedRenameOrigins(context: GitPathMutationContext): Promise<string[]> {
  const renames = await readStagedRenameEntries(context);
  const plan = planGitPathMutation(renames, context.repoPaths, { includeRenameOrigins: true });
  const requested = new Set(context.repoPaths);
  return plan.trackedPaths.filter((path) => !requested.has(path));
}

async function readMutationEntries(
  context: GitPathMutationContext,
  options: { includeRenameOrigins: boolean },
): Promise<GitStatusEntry[]> {
  // 使用 normal 而不是 all：完全未跟踪的大目录只返回一条 `dir/`，避免输出超过上限直接失败。
  const status = await runGit(context, "git status selected paths", [
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=normal",
    "--",
    ...context.repoPaths,
  ]);
  const entries = parseStatusPorcelain(status.stdout).entries;
  if (!options.includeRenameOrigins) {
    return entries;
  }
  return [...entries, ...(await readStagedRenameEntries(context))];
}

async function hasHeadCommit(context: GitPathMutationContext): Promise<boolean> {
  const result = await context.commandProvider.run({
    cwd: context.repoRoot,
    args: ["rev-parse", "--verify", "--quiet", "HEAD"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  ensureGitCommandSucceeded("git rev-parse HEAD", result, [0, 1]);
  return result.exitCode === 0;
}

/**
 * 取消暂存。
 * 修复原因：原实现只把请求路径交给 `git restore --staged`。已暂存的重命名只传新路径时，
 * 原路径的删除仍留在暂存区；仓库尚无提交时 `git restore --staged` 直接报 "could not resolve HEAD"。
 * 修复依据：与 commit(stagedOnly) 一致，先按路径读取状态补齐重命名原路径；无 HEAD 时改用
 * `git rm --cached`，只移出 index、保留工作区文件。
 */
export async function unstageGitPaths(context: GitPathMutationContext): Promise<void> {
  const entries = await readMutationEntries(context, { includeRenameOrigins: true });
  const plan = planGitPathMutation(entries, context.repoPaths, { includeRenameOrigins: true });
  if (plan.trackedPaths.length === 0) {
    return;
  }
  if (await hasHeadCommit(context)) {
    await runGit(context, "git restore --staged", [
      "restore",
      "--staged",
      "--",
      ...plan.trackedPaths,
    ]);
    return;
  }
  await runGit(context, "git rm --cached", [
    "rm",
    "--cached",
    "-r",
    "-q",
    "--",
    ...plan.trackedPaths,
  ]);
}

/**
 * 丢弃变更。
 * 修复原因：原实现对所有路径执行 `git restore`：未跟踪文件报 "did not match any file(s)"，
 * 冲突文件报 "path is unmerged"，已暂存的重命名只恢复新路径导致原文件被删除，无 HEAD 时直接失败。
 * 修复依据：冲突路径整体拒绝、不做部分执行；未跟踪路径用 `git clean -f`（不带 -x，保留被忽略文件）；
 * 已跟踪路径按 staged 选择 restore 参数并补齐重命名原路径；无 HEAD 时用 `git rm -f` 删除新文件。
 */
export async function discardGitPaths(
  context: GitPathMutationContext,
  staged: boolean,
): Promise<void> {
  const entries = await readMutationEntries(context, { includeRenameOrigins: staged });
  const plan = planGitPathMutation(entries, context.repoPaths, { includeRenameOrigins: staged });
  if (plan.conflictedPaths.length > 0) {
    throw new Error(GIT_DISCARD_CONFLICTED_ERROR);
  }
  if (staged) {
    const replaced = findReplacedStagedDeletions(entries, context.repoPaths);
    if (replaced.length > 0) {
      throw new Error(`${GIT_DISCARD_REPLACED_DELETION_ERROR} ${replaced.join(", ")}`);
    }
  }
  // 修复原因：unstaged 丢弃只恢复工作区；只有已暂存删除的路径在 index 中不存在，交给 `restore --worktree`
  // 会以 pathspec 不匹配失败，连带同一路径上重新创建的未跟踪文件也无法丢弃。
  // 修复依据：unstaged 丢弃跳过只匹配到已暂存删除条目的请求路径（它们在工作区一侧没有可恢复的内容）。
  const trackedPaths = staged
    ? plan.trackedPaths
    : plan.trackedPaths.filter((path) =>
        entries.some(
          (entry) =>
            !entry.isUntracked &&
            !isStagedDeletionOnly(entry) &&
            entryMatchesRequestedPath(entry, path),
        ),
      );

  if (trackedPaths.length > 0) {
    if (!staged) {
      await runGit(context, "git restore", ["restore", "--worktree", "--", ...trackedPaths]);
    } else if (await hasHeadCommit(context)) {
      await runGit(context, "git restore", [
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        ...trackedPaths,
      ]);
    } else {
      await runGit(context, "git rm", ["rm", "-f", "-r", "-q", "--", ...trackedPaths]);
    }
  }

  if (plan.untrackedPaths.length > 0) {
    await runGit(context, "git clean", ["clean", "-f", "-q", "--", ...plan.untrackedPaths]);
    // 修复原因：只加一个 -f 时 git clean 不删除嵌套的 Git 仓库，却以 0 退出，界面当作已丢弃，该行却仍在。
    // 修复依据：不加第二个 -f（嵌套仓库可能有未推送的提交，确认文案也没有说明会删除仓库）；清理后重新读取这些路径的
    // 状态，仍有未跟踪内容时报错并列出这些路径。
    const remaining = planGitPathMutation(
      await readMutationEntries(
        { ...context, repoPaths: plan.untrackedPaths },
        { includeRenameOrigins: false },
      ),
      plan.untrackedPaths,
      { includeRenameOrigins: false },
    ).untrackedPaths;
    if (remaining.length > 0) {
      throw new Error(`${GIT_DISCARD_NESTED_REPOSITORY_ERROR} ${remaining.join(", ")}`);
    }
  }
}
