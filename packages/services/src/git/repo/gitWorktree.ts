/**
 * 在仓库外创建新 worktree 并检出新分支。规范：docs/specs/git-worktree-task.md
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  GitCreateWorktreeResult,
  GitManagedWorktree,
  GitRemoveWorktreeLeftoverResult,
  GitRemoveWorktreeResult,
} from "@zcode/shared";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS, DEFAULT_GIT_OUTPUT_BYTES } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { isRelativePathInside } from "../../fs/pathContainment.js";
import { parseGitBranchMutationIssues } from "./gitCliHelpers.js";

/** worktree add 会检出整棵树，大仓库远超普通 Git 命令的 15s。 */
const GIT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000;
const MAX_WORKTREE_NAME_ATTEMPTS = 99;
/** ZCode 创建标记：写在链接 worktree 自己的 Git 管理目录中，worktree remove/prune 时随之删除。 */
const MANAGED_WORKTREE_MARKER = "zcode-worktree.json";

/** 目录名上限（ASCII），留出 `wt-` 前缀与 `-99` 重名后缀的空间，远低于 255 字节。 */
const MAX_WORKTREE_SLUG_LENGTH = 80;

// Windows 保留设备名：按首个 "." 之前的部分判断，不区分大小写（与 workspaceRemovalSafety 的规则一致）。
const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * 分支名 → 目录名。导出供单测使用。
 * @lintignore
 */
export function toWorktreeSlug(name: string): string {
  let slug = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  if (!slug) return "worktree";
  // 修复原因：分支名每段都可以很长，扁平化后可能超过常见文件系统 255 字节的单段上限，git worktree add 必然失败。
  // 修复依据：超过上限时截断并追加原名的短哈希，目录名仍确定且不同分支不会因截断相撞。
  if (slug.length > MAX_WORKTREE_SLUG_LENGTH) {
    const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
    slug = `${slug.slice(0, MAX_WORKTREE_SLUG_LENGTH - hash.length - 1).replace(/[-.]+$/, "")}-${hash}`;
  }
  // 修复原因：con、aux、com1 等是合法分支名，但在 Windows 上不能作为目录名，git worktree add 会失败。
  // 修复依据：所有平台统一加前缀（追加后缀无效：CON.xxx 仍是保留名），目录名保持确定。
  return WINDOWS_RESERVED_BASENAME.test(slug) ? `wt-${slug}` : slug;
}

/**
 * 同一仓库的 worktree 放在同一目录下；哈希区分同名仓库。导出供单测使用。
 * @lintignore
 */
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

  // 修复原因：git 在检出前就建好了新分支；检出失败（如 smudge 过滤器出错）或超时被终止时，分支（有时还有登记为锁定、
  // 检出一半的目录）会留下，同样的输入重试报“分支已存在”，只能手动修复仓库。
  // 修复依据：先记下起点提交与分支是否已存在，从该提交创建；失败后回滚这次尝试留下的内容。
  const [head, existingBranch] = await Promise.all([
    readCommit(context, "HEAD"),
    readCommit(context, `refs/heads/${branchName}`),
  ]);
  const baseCommit = head.kind === "found" ? head.oid : null;
  // 分支名已经过 check-ref-format 校验，路径为绝对路径，都不会被当成选项解析。
  const result = await context.commandProvider.run({
    cwd: context.repoRoot,
    args: ["worktree", "add", "-b", branchName, worktreePath, baseCommit ?? "HEAD"],
    timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    // 修复原因：分支查询超时或失败时也会得到“不存在”，已有分支恰好指向 HEAD 时回滚会把用户的分支删掉。
    // 修复依据：只有确认分支原本不存在（rev-parse 正常以 1 退出、没有输出）时才回滚，无法判断时保留现场。
    if (baseCommit && existingBranch.kind === "missing") {
      await rollBackFailedWorktreeAdd({ ...context, worktreePath, baseCommit }).catch(
        () => undefined,
      );
    }
    return { ok: false, branchName, issues: parseGitBranchMutationIssues(result) };
  }
  await writeManagedWorktreeMarker(context.commandProvider, worktreePath);

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

/** 引用查询结果：找到、确认不存在，或无法判断（超时、输出超限、其它错误）。 */
type CommitLookup = { kind: "found"; oid: string } | { kind: "missing" } | { kind: "unknown" };

async function readCommit(
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
async function rollBackFailedWorktreeAdd(context: {
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

/** 链接 worktree 的 Git 管理目录（`<common-dir>/worktrees/<name>`）。 */
async function readWorktreeAdminDir(
  commandProvider: GitCommandProvider,
  worktreePath: string,
): Promise<string | null> {
  const result = await commandProvider.run({
    cwd: worktreePath,
    args: ["rev-parse", "--absolute-git-dir"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  const adminDir = result.exitCode === 0 ? result.stdout.trim() : "";
  return adminDir.length > 0 ? adminDir : null;
}

async function writeManagedWorktreeMarker(
  commandProvider: GitCommandProvider,
  worktreePath: string,
): Promise<void> {
  const adminDir = await readWorktreeAdminDir(commandProvider, worktreePath);
  if (!adminDir) return;
  // 写入失败时 worktree 仍然可用，只是不会出现“删除 worktree”入口（失败方向是安全的）。
  await writeFile(
    join(adminDir, MANAGED_WORKTREE_MARKER),
    `${JSON.stringify({ createdBy: "zcode", worktreePath: await realpathOrSelf(worktreePath) })}\n`,
    { encoding: "utf-8", mode: 0o600 },
  ).catch(() => undefined);
}

/**
 * 修复原因：只按“位于 worktreesRootDir 下”判断归属时，用户手动创建或导入到该目录的 worktree 也会得到
 * 强制删除入口，违背“用户自建 worktree 不可删除”的约定。
 * 修复依据：创建时在该 worktree 的 Git 管理目录写入标记，读取时要求标记存在且指向同一目录。
 * 该目录不属于仓库内容，克隆或检出无法伪造。
 */
async function hasManagedWorktreeMarker(
  commandProvider: GitCommandProvider,
  worktreePath: string,
  resolvedWorktreeRoot: string,
): Promise<boolean> {
  const adminDir = await readWorktreeAdminDir(commandProvider, worktreePath);
  if (!adminDir) return false;
  try {
    const marker = JSON.parse(await readFile(join(adminDir, MANAGED_WORKTREE_MARKER), "utf-8")) as {
      createdBy?: unknown;
      worktreePath?: unknown;
    };
    return (
      marker.createdBy === "zcode" &&
      typeof marker.worktreePath === "string" &&
      (await realpathOrSelf(marker.worktreePath)) === resolvedWorktreeRoot
    );
  } catch {
    return false;
  }
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
  return relativePath.length > 0 && isRelativePathInside(relativePath);
}

/**
 * 只有 ZCode 创建的链接 worktree（位于 worktreesRootDir 下、不是主检出、且带有 ZCode 创建标记）才返回信息；
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
  if (!(await hasManagedWorktreeMarker(context.commandProvider, current.path, worktreeRoot))) {
    return null;
  }
  // 修复原因：只有被忽略的文件（如 .env、安装的依赖）时 status 没有输出，界面跳过“永久丢失”确认，
  // 而 git worktree remove 会连同这些文件一起删除。修复依据：带 --ignored 读取，被忽略的条目（`!! `）单独报告。
  const status = await context.commandProvider.run({
    cwd: current.path,
    args: ["status", "--porcelain", "--untracked-files=normal", "--ignored"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  const lines = status.stdout.split("\n").filter((line) => line.length > 0);
  const instanceId = (await readDirectoryIdentity(current.path).catch(() => null)) ?? "";
  // 修复原因：status 失败、超时或输出超限时只记为“有未提交改动”、被忽略的文件记为没有；用户只同意丢弃改动后，
  // 删除时同样读取失败即会带 --force 删掉从未提示过的被忽略文件（如 .env）。
  // 修复依据：读不出状态时无法区分两类内容，两者都按存在处理并标出 statusUnknown，删除前须同时同意两类内容。
  const statusUnknown = status.exitCode !== 0 || status.timedOut || status.outputTruncated;
  return {
    worktreePath: current.path,
    mainWorktreePath: main.path,
    branchName: current.branchName,
    hasUncommittedChanges: statusUnknown || lines.some((line) => !line.startsWith("!! ")),
    hasIgnoredFiles: statusUnknown || lines.some((line) => line.startsWith("!! ")),
    ...(statusUnknown ? { statusUnknown: true } : {}),
    instanceId,
  };
}

export async function removeManagedWorktree(context: {
  commandProvider: GitCommandProvider;
  worktree: GitManagedWorktree | null;
  /** 用户已同意丢弃未提交改动。 */
  force: boolean;
  /** 用户已同意删除被 Git 忽略的文件。 */
  discardIgnored?: boolean;
  /** 用户确认时的 worktree 身份。 */
  expectedInstanceId?: string;
}): Promise<GitRemoveWorktreeResult> {
  const { worktree } = context;
  if (!worktree) {
    return { ok: false, reason: "not-managed" };
  }
  // 修复原因：确认期间该 worktree 可能被外部删除、并在同一路径上建了另一个 ZCode worktree，按路径删除会删掉
  // 用户没有确认过的检出。修复依据：带上确认时的目录身份，不一致时不删除。
  if (
    context.expectedInstanceId !== undefined &&
    worktree.instanceId !== context.expectedInstanceId
  ) {
    return { ok: false, reason: "changed" };
  }
  // 修复原因：未带 force 的 git worktree remove 仍会删除被忽略的文件；用户只同意丢失其中一类内容时，
  // 确认之后才出现的另一类内容也会被删除。修复依据：按用户同意丢失的内容分别判断，出现未同意的内容时返回 dirty；
  // 只有同意丢弃未提交改动时才带 --force（只有被忽略的文件时不需要）。
  if (
    (worktree.hasUncommittedChanges && !context.force) ||
    (worktree.hasIgnoredFiles && !context.discardIgnored)
  ) {
    return { ok: false, reason: "dirty" };
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
    const detail = result.stderr.trim() || result.stdout.trim();
    // 修复原因：目录删除中途失败（如 Windows 目录占用）时，git 可能已删除管理目录，登记与创建标记一并消失，
    // 剩下的目录再也无法按 worktree 识别，重试只会得到 not-managed。
    // 修复依据：失败后检查登记是否还在；已不在时返回 leftover，由 removeLeftoverWorktreeDir 清理剩余目录。
    if (await isRegisteredWorktree(context.commandProvider, worktree)) {
      return { ok: false, reason: "failed", detail };
    }
    const leftoverId = await readDirectoryIdentity(worktree.worktreePath);
    if (leftoverId === null) {
      // 登记已撤销、目录也已不在：等同于删除成功。
      return {
        ok: true,
        mainWorktreePath: worktree.mainWorktreePath,
        branchName: worktree.branchName,
      };
    }
    return { ok: false, reason: "leftover", leftoverId, detail };
  }
  return { ok: true, mainWorktreePath: worktree.mainWorktreePath, branchName: worktree.branchName };
}

async function isRegisteredWorktree(
  commandProvider: GitCommandProvider,
  worktree: GitManagedWorktree,
): Promise<boolean> {
  const result = await commandProvider.run({
    cwd: worktree.mainWorktreePath,
    args: ["worktree", "list", "--porcelain"],
    timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_GIT_OUTPUT_BYTES,
  });
  // 无法读取登记时按“仍登记”处理：走普通重试，不删除任何目录。
  if (result.exitCode !== 0) return true;
  const target = await realpathOrSelf(worktree.worktreePath);
  const entries = parseWorktreeList(result.stdout);
  for (const entry of entries) {
    if (entry.path === worktree.worktreePath || (await realpathOrSelf(entry.path)) === target) {
      return true;
    }
  }
  return false;
}

/** 目录是否仍是有效的 Git 检出：`.git` 为目录，或 `.git` 文件指向仍存在的管理目录。无法判断时按有效处理。 */
async function isLiveGitCheckout(dir: string): Promise<boolean> {
  let gitEntry;
  try {
    gitEntry = await lstat(join(dir, ".git"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  if (!gitEntry.isFile()) return true;
  const match = /^gitdir:\s*(.+)$/m.exec(await readFile(join(dir, ".git"), "utf-8"));
  const gitDir = match?.[1]?.trim();
  if (!gitDir) return true;
  return await pathExists(isAbsolute(gitDir) ? gitDir : resolve(dir, gitDir));
}

/**
 * 路径本身（不跟随符号链接）是真实目录时返回其身份：设备号、inode 与创建时间；不存在返回 null；
 * 是链接或其它类型时返回 "not-directory"。创建时间用于区分同路径上重建、复用了同一 inode 的目录。
 */
async function readDirectoryIdentity(path: string): Promise<string | null> {
  try {
    const stats = await lstat(path, { bigint: true });
    if (!stats.isDirectory()) return "not-directory";
    return `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * 清理 removeManagedWorktree 返回 leftover 后剩下的目录。只允许删除 `<worktreesRootDir>/<仓库目录>/<worktree 目录>`
 * 这一层、已不是有效 Git 检出、且仍是失败时那个目录（身份与 leftoverId 一致）的目录；目录已不存在视为成功。
 * 修复原因：重试可能在很久之后才点击，期间该路径可能已被删除后换成新目录，或换成指向另一个第二层目录的链接，
 * 只按当前路径判断会递归删除用户未确认过的内容。修复依据：比较失败时记录的目录身份，不跟随链接。
 */
export async function removeLeftoverWorktreeDir(context: {
  worktreePath: string;
  leftoverId: string;
  worktreesRootDir: string;
}): Promise<GitRemoveWorktreeLeftoverResult> {
  let target: string;
  try {
    const identity = await readDirectoryIdentity(context.worktreePath);
    if (identity === null) return { ok: true };
    if (identity !== context.leftoverId) return { ok: false, reason: "not-leftover" };
    target = await realpath(context.worktreePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true };
    return { ok: false, reason: "failed", detail: (error as Error).message };
  }
  const root = await realpathOrSelf(context.worktreesRootDir);
  const relativePath = relative(root, target);
  const depth = relativePath.split(sep).filter(Boolean).length;
  if (!isInsideDir(target, root) || depth !== 2 || (await isLiveGitCheckout(target))) {
    return { ok: false, reason: "not-leftover" };
  }
  try {
    await rm(target, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", detail: (error as Error).message };
  }
}
