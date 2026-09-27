import type {
  GitBranchMutationResult,
  GitBranchComparison,
  GitCommitGraphRequest,
  GitCommitGraphResult,
  GitCreateBranchRequest,
  GitChangesRequest,
  GitCommitRequest,
  GitCommitResult,
  GitDiffQuery,
  GitDiffResult,
  GitDiscardPathsRequest,
  GitGenerateCommitMessageRequest,
  GitGenerateCommitMessageResult,
  GitIdentity,
  GitIgnoredPathsRequest,
  GitLocalBranchListResult,
  GitPathMutationRequest,
  GitCreateWorktreeRequest,
  GitCreateWorktreeResult,
  GitManagedWorktree,
  GitRemoveWorktreeLeftoverRequest,
  GitRemoveWorktreeLeftoverResult,
  GitRemoveWorktreeRequest,
  GitRemoveWorktreeResult,
  GitPushRequest,
  GitPushResult,
  GitRefreshRequest,
  GitRefreshResult,
  GitRepositoryRequest,
  GitRepositorySummary,
  GitWorkspaceRepositoryInfo,
  GitFileChange,
  GitSwitchBranchRequest,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IGitService {
  getRepositorySummary(params: GitRepositoryRequest): Promise<GitRepositorySummary>;
  getWorkspaceRepositoryInfo(params: GitRepositoryRequest): Promise<GitWorkspaceRepositoryInfo>;
  getLocalBranches(params: GitRepositoryRequest): Promise<GitLocalBranchListResult>;
  getCommitGraph(params: GitCommitGraphRequest): Promise<GitCommitGraphResult>;
  switchBranch(params: GitSwitchBranchRequest): Promise<GitBranchMutationResult>;
  createBranchAndSwitch(params: GitCreateBranchRequest): Promise<GitBranchMutationResult>;
  getChanges(params: GitChangesRequest): Promise<GitFileChange[]>;
  getIgnoredPaths(params: GitIgnoredPathsRequest): Promise<string[]>;
  getDiff(params: GitDiffQuery): Promise<GitDiffResult>;
  getBranchComparison(params: GitRepositoryRequest): Promise<GitBranchComparison>;
  stagePaths(params: GitPathMutationRequest): Promise<void>;
  unstagePaths(params: GitPathMutationRequest): Promise<void>;
  discardPaths(params: GitDiscardPathsRequest): Promise<void>;
  generateCommitMessage(
    params: GitGenerateCommitMessageRequest,
  ): Promise<GitGenerateCommitMessageResult>;
  commit(params: GitCommitRequest): Promise<GitCommitResult>;
  push(params: GitPushRequest): Promise<GitPushResult>;
  /** 当前分支上游对应的托管平台新建 PR 链接；无上游或未知平台时为 null。规范：docs/specs/git-pull-request-link.md */
  /** 在仓库外新建 worktree 并检出新分支。规范：docs/specs/git-worktree-task.md */
  createWorktree(params: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResult>;
  /** ZCode 创建的链接 worktree 信息；其它检出返回 null。 */
  getManagedWorktree(params: GitRepositoryRequest): Promise<GitManagedWorktree | null>;
  /** 删除 ZCode 创建的 worktree（保留分支）。 */
  removeWorktree(params: GitRemoveWorktreeRequest): Promise<GitRemoveWorktreeResult>;
  /** 清理 removeWorktree 返回 leftover 后剩下的目录（只限 ZCode worktrees 目录下已失效的检出）。 */
  removeWorktreeLeftover(
    params: GitRemoveWorktreeLeftoverRequest,
  ): Promise<GitRemoveWorktreeLeftoverResult>;
  getIdentity(params: GitRepositoryRequest): Promise<GitIdentity>;
  refresh(params: GitRefreshRequest): Promise<GitRefreshResult>;
}

export const IGitService = createServiceDescriptor<IGitService>(ServiceChannels.Git);
