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
  "path" | "section" | "kind" | "isConflicted" | "isUntracked"
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
  /** 批量丢弃中会从磁盘删除的新文件数量（未跟踪，或已暂存的新增文件），用于确认文案。 */
  discardDeletedFileCount: number;
}

export function getGitPaneBulkActionPlan(
  changes: readonly GitPaneActionableChange[],
  context: GitPaneFileActionContext,
): GitPaneBulkActionPlan {
  const plan: GitPaneBulkActionPlan = {
    stagePaths: [],
    unstagePaths: [],
    discardPaths: [],
    discardDeletedFileCount: 0,
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
      if (gitPaneDiscardDeletesFile(change, context.sourceId)) {
        plan.discardDeletedFileCount += 1;
      }
    }
  }
  return plan;
}

/**
 * 丢弃是否会把文件从磁盘删除：未跟踪文件会被 git clean 删除；staged 来源里新增的文件恢复到 HEAD
 * 后同样不存在。确认弹框必须明确提示，不能只说“丢弃更改”。
 */
export function gitPaneDiscardDeletesFile(
  change: Pick<GitFileChange, "kind" | "isUntracked">,
  sourceId: GitChangeSourceId,
): boolean {
  return change.isUntracked || (sourceId === "staged" && change.kind === "added");
}

/** `discardPaths` 的 staged 参数：staged 来源要同时恢复 index 与工作区。 */
export function isGitPaneDiscardStaged(sourceId: GitChangeSourceId): boolean {
  return sourceId === "staged";
}
