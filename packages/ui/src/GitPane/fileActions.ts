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
  "path" | "repoRelativePath" | "section" | "kind" | "isConflicted" | "isUntracked"
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
  /** 其中折叠显示的未跟踪目录（`dir/`）数量：整个目录连同内容都会被删除，不能按一个文件计。 */
  discardDeletedFolderCount: number;
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
    discardDeletedFolderCount: 0,
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
      const deletion = getGitPaneDiscardDeletion(change, context.sourceId);
      if (deletion === "folder") {
        plan.discardDeletedFolderCount += 1;
      } else if (deletion === "file") {
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

/**
 * 丢弃会从磁盘删除的内容：单个文件、整个未跟踪目录，或不删除。
 * 修复原因：git status 输出超限后改用 `--untracked-files=normal`，整个未跟踪目录只显示为一条 `dir/`，
 * 而 `git clean -f -- dir/` 会递归删除其中所有文件；按“一个新文件”计数会明显低估损失。
 * 修复依据：`repoRelativePath` 以 `/` 结尾的未跟踪条目单独按目录计（绝对路径 `path` 经 resolve 后不再带 `/`），
 * 确认文案说明目录及其全部内容会被删除。
 */
export function getGitPaneDiscardDeletion(
  change: Pick<GitFileChange, "repoRelativePath" | "kind" | "isUntracked">,
  sourceId: GitChangeSourceId,
): "file" | "folder" | null {
  if (!gitPaneDiscardDeletesFile(change, sourceId)) return null;
  return change.isUntracked && change.repoRelativePath.endsWith("/") ? "folder" : "file";
}

/** `discardPaths` 的 staged 参数：staged 来源要同时恢复 index 与工作区。 */
export function isGitPaneDiscardStaged(sourceId: GitChangeSourceId): boolean {
  return sourceId === "staged";
}
