import type { GitChangeSourceId, GitFileChange } from "@zcode/shared";

/**
 * Review 面板文件级 Git 操作的可用性与批量路径选择（纯函数）。
 * 规范：docs/specs/git-review-pane-file-actions.md
 */
export type GitPaneFileActionId = "stage" | "unstage" | "discard";

export interface GitPaneFileActionContext {
  sourceId: GitChangeSourceId;
  /** 当前数据集是否只读（branch / last-turn）。 */
  datasetReadonly: boolean;
  /** 仓库已加载完成、无错误、Git 可用且当前 workspace 是仓库。 */
  repositoryReady: boolean;
}

type GitPaneActionableChange = Pick<
  GitFileChange,
  "path" | "section" | "isConflicted" | "isUntracked"
>;

function isConflictedChange(change: GitPaneActionableChange): boolean {
  return change.isConflicted || change.section === "conflicted";
}

export function getGitPaneFileActions(
  change: GitPaneActionableChange,
  context: GitPaneFileActionContext,
): GitPaneFileActionId[] {
  if (!context.repositoryReady || context.datasetReadonly) {
    return [];
  }
  if (context.sourceId === "unstaged") {
    // 冲突文件只能“暂存”（即标记为已解决）；丢弃会被服务端拒绝，界面不提供入口。
    return isConflictedChange(change) ? ["stage"] : ["stage", "discard"];
  }
  if (context.sourceId === "staged") {
    return ["unstage", "discard"];
  }
  return [];
}

export interface GitPaneBulkActionPlan {
  stagePaths: string[];
  unstagePaths: string[];
  discardPaths: string[];
  /** 批量丢弃中会被删除的未跟踪文件数量，用于确认文案。 */
  discardUntrackedCount: number;
}

export function getGitPaneBulkActionPlan(
  changes: readonly GitPaneActionableChange[],
  context: GitPaneFileActionContext,
): GitPaneBulkActionPlan {
  const plan: GitPaneBulkActionPlan = {
    stagePaths: [],
    unstagePaths: [],
    discardPaths: [],
    discardUntrackedCount: 0,
  };
  for (const change of changes) {
    const actions = getGitPaneFileActions(change, context);
    if (actions.includes("stage")) {
      plan.stagePaths.push(change.path);
    }
    if (actions.includes("unstage")) {
      plan.unstagePaths.push(change.path);
    }
    if (actions.includes("discard")) {
      plan.discardPaths.push(change.path);
      if (change.isUntracked) {
        plan.discardUntrackedCount += 1;
      }
    }
  }
  return plan;
}

/** `discardPaths` 的 staged 参数：staged 来源要同时恢复 index 与工作区。 */
export function isGitPaneDiscardStaged(sourceId: GitChangeSourceId): boolean {
  return sourceId === "staged";
}
