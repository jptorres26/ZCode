import type { GitPullRequestLink } from "./gitPullRequestLink.js";
import type { Locale } from "./protocol.js";

export type GitHeadRefType = "branch" | "detached";

export type GitChangeKind = "modified" | "added" | "deleted" | "renamed";

export type GitChangeSourceId = "unstaged" | "staged" | "branch" | "last-turn";

export type GitRepositoryChangeSourceId = Extract<
  GitChangeSourceId,
  "unstaged" | "staged" | "branch"
>;

export type GitChangeSectionId =
  | "staged"
  | "unstaged"
  | "untracked"
  | "conflicted"
  | "branch"
  | "last-turn";

export type GitDiffAvailability = "patch" | "binary" | "truncated" | "unavailable";

export type GitBranchMutationAction = "switch" | "create-and-switch";

export type GitBranchMutationIssueCode =
  | "invalid-branch-name"
  | "branch-already-exists"
  | "target-branch-not-found"
  | "tracked-changes-would-be-overwritten"
  | "untracked-changes-would-be-overwritten"
  | "conflicts-present"
  | "operation-in-progress"
  | "branch-in-other-worktree"
  | "unknown";

export interface GitRepositorySummary {
  workspacePath: string;
  repoRoot: string;
  workspaceInRepoPath: string;
  /** Git 元数据 watcher 边界；workspace 内容 watcher 由 UI 按 workspace Host 平台决定。 */
  autoRefreshWatchPaths: GitRepositoryAutoRefreshWatchPath[];
  branchName: string | null;
  trackingBranchName: string | null;
  headRefType: GitHeadRefType;
  ahead: number;
  behind: number;
  isDirty: boolean;
  isGitAvailable: boolean;
  isRepository: boolean;
}

export interface GitRepositoryAutoRefreshWatchPath {
  path: string;
  recursive: boolean;
}

export interface GitFileChange {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  x?: string;
  y?: string;
  kind: GitChangeKind;
  section: GitChangeSectionId;
  added: number;
  removed: number;
  isStaged: boolean;
  isUntracked: boolean;
  isConflicted: boolean;
  /** 子模块（gitlink）条目：工作区中是目录，不能按文件预览。 */
  isSubmodule?: boolean;
  /** 子模块检出的提交与 index 相同，工作区一侧的改动只在子模块内部：暂存不会记录任何内容。 */
  isSubmoduleContentOnly?: boolean;
  /** 工作区中已没有该文件（如 index 中已修改、工作区中已删除），不能按文件预览。 */
  isMissingInWorkingTree?: boolean;
}

export interface GitDiffRequest {
  path: string;
  staged?: boolean;
  sourceId?: GitChangeSourceId;
}

export interface GitDiffResult {
  path: string;
  availability: GitDiffAvailability;
  patch: string | null;
  beforeContent: string | null;
  afterContent: string | null;
  summary?: string | null;
}

export interface GitIdentity {
  userName: string | null;
  userEmail: string | null;
  nameSource: string | null;
  emailSource: string | null;
  scopeLabel?: string | null;
}

export interface GitRepositoryRequest {
  workspacePath: string;
}

export type GitCommitGraphRefKind = "branch" | "remote" | "tag" | "head";

export interface GitCommitGraphRef {
  name: string;
  kind: GitCommitGraphRefKind;
}

export interface GitCommitGraphCommit {
  hash: string;
  parents: string[];
  refs: GitCommitGraphRef[];
  subject: string;
  authorName: string | null;
  authoredAtMs: number | null;
}

export interface GitCommitGraphRequest extends GitRepositoryRequest {
  maxCount?: number;
  skip?: number;
}

export interface GitCommitGraphResult {
  commits: GitCommitGraphCommit[];
  hasMore: boolean;
}

export interface GitRefreshRequest extends GitRepositoryRequest {
  includeIdentity?: boolean;
  includeBranchComparison?: boolean;
}

export type GitWorkspaceRepositoryKind = "not-repository" | "main-tree" | "linked-worktree";

export interface GitWorkspaceRepositoryInfo {
  workspacePath: string;
  kind: GitWorkspaceRepositoryKind;
  isGitAvailable: boolean;
}

export interface GitSwitchBranchRequest extends GitRepositoryRequest {
  targetBranchName: string;
}

export interface GitCreateBranchRequest extends GitRepositoryRequest {
  branchName: string;
  startPoint?: string;
}

export interface GitChangesRequest extends GitRepositoryRequest {
  sourceId: Extract<GitRepositoryChangeSourceId, "unstaged" | "staged">;
}

export interface GitIgnoredPathsRequest extends GitRepositoryRequest {
  paths: string[];
}

export interface GitDiffQuery extends GitRepositoryRequest, GitDiffRequest {}

export interface GitBranchComparison {
  baseRef: string | null;
  headRef: string | null;
  comparisonLabel: string | null;
  changes: GitFileChange[];
}

export interface GitLocalBranch {
  name: string;
  isCurrent: boolean;
  upstreamName: string | null;
  commitHash: string | null;
  commitTimestampMs: number | null;
}

export interface GitLocalBranchListResult {
  headRefType: GitHeadRefType;
  currentBranchName: string | null;
  branches: GitLocalBranch[];
}

export interface GitBranchMutationIssue {
  code: GitBranchMutationIssueCode;
  message: string;
  paths?: string[];
  detail?: string | null;
}

export interface GitBranchMutationResult {
  ok: boolean;
  action: GitBranchMutationAction;
  branchName: string | null;
  didChange: boolean;
  created: boolean;
  summary: GitRepositorySummary;
  issues: GitBranchMutationIssue[];
}

/** 在新 worktree 中开始任务。规范：docs/specs/git-worktree-task.md */
export interface GitCreateWorktreeRequest extends GitRepositoryRequest {
  branchName: string;
}

export type GitCreateWorktreeResult =
  | {
      ok: true;
      branchName: string;
      /** 新 worktree 的根目录。 */
      worktreePath: string;
      /** 与原 workspace 在仓库中的相对位置对应的新 workspace 路径。 */
      workspacePath: string;
    }
  | { ok: false; branchName: string | null; issues: GitBranchMutationIssue[] };

/** ZCode 创建的链接 worktree。规范：docs/specs/git-worktree-task.md（删除 worktree） */
export interface GitManagedWorktree {
  worktreePath: string;
  mainWorktreePath: string;
  branchName: string | null;
  /** 读取时的状态：有未提交改动（含未跟踪文件）。删除前据此先确认，再释放运行时。 */
  hasUncommittedChanges: boolean;
  /** 读取时的状态：有被 Git 忽略的文件（如本地配置、安装的依赖），删除 worktree 会一并永久删除。 */
  hasIgnoredFiles: boolean;
  /** 读不出状态（status 失败、超时或输出超限）：上面两项都按存在处理，确认文案说明无法确认其中内容。 */
  statusUnknown?: boolean;
  /** 该 worktree 目录的身份（设备号、inode 与创建时间）：确认之后据此确认仍是同一个 worktree。 */
  instanceId: string;
}

export interface GitRemoveWorktreeRequest extends GitRepositoryRequest {
  /** 用户已同意丢弃未提交改动：有未提交改动时仍然删除。 */
  force?: boolean;
  /** 用户已同意删除被 Git 忽略的文件：有这类文件时仍然删除。 */
  discardIgnored?: boolean;
  /** 用户确认时的 instanceId；与删除时的 worktree 不同则不删除（reason 为 changed）。 */
  expectedInstanceId?: string;
}

export type GitRemoveWorktreeResult =
  | { ok: true; mainWorktreePath: string; branchName: string | null }
  /** changed：该路径上已不是用户确认的那个 worktree。 */
  | { ok: false; reason: "not-managed" | "dirty" | "changed" | "failed"; detail?: string }
  /**
   * git 已撤销登记但目录未能删净（常见于 Windows 目录占用）；用 removeWorktreeLeftover 清理剩余目录。
   * leftoverId 为失败时该目录的文件系统身份（设备号、inode 与创建时间），清理时据此确认仍是同一目录。
   */
  | { ok: false; reason: "leftover"; leftoverId: string; detail?: string };

export interface GitRemoveWorktreeLeftoverRequest {
  /** 之前 getManagedWorktree 返回的 worktreePath。 */
  worktreePath: string;
  /** removeWorktree 返回 leftover 时给出的 leftoverId。 */
  leftoverId: string;
}

export type GitRemoveWorktreeLeftoverResult =
  | { ok: true }
  /** not-leftover：不是可清理的剩余目录，或已不是失败时的那个目录（被替换或换成链接）。 */
  | { ok: false; reason: "not-leftover" | "failed"; detail?: string };

export interface GitPathMutationRequest extends GitRepositoryRequest {
  paths: string[];
}

export interface GitDiscardPathsRequest extends GitPathMutationRequest {
  staged?: boolean;
  /**
   * 确认框告知会从磁盘删除的路径（paths 的子集，同一形式）。服务端按最新状态重新规划，
   * 还会删除其它路径时拒绝整个丢弃、不做任何修改。
   */
  confirmedDeletionPaths: string[];
}

export interface GitCommitRequest extends GitRepositoryRequest {
  message: string;
  paths?: string[];
  stagedOnly?: boolean;
}

export interface GitCommitResult {
  commitHash: string;
  summary: GitRepositorySummary;
}

export interface GitGenerateCommitMessageRequest extends GitRepositoryRequest {
  workspaceIdentity?: string;
  locale?: Locale;
  includeUnstaged?: boolean;
  currentSessionFilePaths?: string[];
  conversationContext?: GitCommitMessageConversationContext;
}

export interface GitCommitMessageConversationContext {
  sessionId?: string;
  omittedMessageCount?: number;
  messages: GitCommitMessageConversationMessage[];
}

export interface GitCommitMessageConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GitGenerateCommitMessageResult {
  message: string;
  providerId: string;
  model: string;
}

export interface GitPushRequest extends GitRepositoryRequest {}

export interface GitPushResult {
  branchName: string | null;
  trackingBranchName: string | null;
  remoteName: string | null;
  setUpstream: boolean;
  summary: GitRepositorySummary;
  /** 这次推送的当前分支在托管平台上新建 PR 的链接（取自推送输出）；无法构造时为 null。 */
  pullRequestLink: GitPullRequestLink | null;
}

export interface GitRefreshResult {
  summary: GitRepositorySummary;
  identity: GitIdentity | null;
  unstagedChanges: GitFileChange[];
  stagedChanges: GitFileChange[];
  branchComparison: GitBranchComparison | null;
}

export type GitCheckpointScope = "workspace";

export type GitCheckpointConflictReason =
  | "content-mismatch"
  | "missing-in-worktree"
  | "unexpected-file-in-worktree"
  | "type-mismatch";

export interface GitCheckpointMeta {
  checkpointId: string;
  workspacePath: string;
  repoRoot: string;
  workspaceInRepoPath: string;
  createdAt: number;
  refName: string;
  commitOid: string;
  scope: GitCheckpointScope;
}

export interface GitCheckpointRequest extends GitRepositoryRequest {
  checkpointId: string;
}

export interface GitCheckpointDiffQuery extends GitRepositoryRequest {
  fromCheckpointId: string;
  toCheckpointId: string;
}

export interface GitCheckpointFileDiff {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  originalPath?: string | null;
  kind: GitChangeKind;
  added: number;
  removed: number;
}

export interface GitCheckpointDiff {
  fromCheckpointId: string;
  toCheckpointId: string;
  files: GitCheckpointFileDiff[];
}

export interface GitCheckpointRestoreQuery extends GitCheckpointDiffQuery {
  force?: boolean;
}

export interface GitCheckpointConflict {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  reason: GitCheckpointConflictReason;
}

export interface GitCheckpointRestoreResult {
  success: boolean;
  conflicts?: GitCheckpointConflict[];
  restoredPaths?: string[];
}
