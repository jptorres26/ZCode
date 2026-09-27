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

/**
 * getGitPaneBulkActionPlan 的返回类型。
 * @lintignore
 */
export interface GitPaneBulkActionPlan {
  stagePaths: string[];
  unstagePaths: string[];
  discardPaths: string[];
  /** 批量丢弃中会从磁盘删除的新文件（未跟踪，或已暂存的新增文件）：数量用于确认文案，路径随请求交给服务端核对。 */
  discardDeletedFilePaths: string[];
  /** 其中折叠显示的未跟踪目录（`dir/`）：整个目录连同内容都会被删除，不能按一个文件计。 */
  discardDeletedFolderPaths: string[];
}

export function getGitPaneBulkActionPlan(
  changes: readonly GitPaneActionableChange[],
  context: GitPaneFileActionContext,
): GitPaneBulkActionPlan {
  const plan: GitPaneBulkActionPlan = {
    stagePaths: [],
    unstagePaths: [],
    discardPaths: [],
    discardDeletedFilePaths: [],
    discardDeletedFolderPaths: [],
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
        plan.discardDeletedFolderPaths.push(change.path);
      } else if (deletion === "file") {
        plan.discardDeletedFilePaths.push(change.path);
      }
    }
  }
  return plan;
}

/**
 * 丢弃是否会把文件从磁盘删除：未跟踪文件会被 git clean 删除；staged 来源里新增的文件恢复到 HEAD
 * 后同样不存在。确认弹框必须明确提示，不能只说“丢弃更改”。
 */
function gitPaneDiscardDeletesFile(
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
  return isCollapsedUntrackedDirectory(change) ? "folder" : "file";
}

/** status 输出超限后折叠显示的整个未跟踪目录（`dir/`）。 */
function isCollapsedUntrackedDirectory(
  change: Pick<GitFileChange, "repoRelativePath" | "isUntracked">,
): boolean {
  return change.isUntracked && change.repoRelativePath.endsWith("/");
}

/**
 * “打开文件”是否可用：已删除的文件、工作区中已不存在的文件、折叠显示的未跟踪目录和子模块都没有可预览的文件。
 * 修复原因：折叠目录的 kind 为 added、子模块是普通的 modified 条目、`MD`（index 中已修改、工作区中已删除）的
 * kind 按 index 一侧为 modified，旧条件只排除 deleted，会把目录或不存在的路径交给文件预览并报读取错误。
 * 修复依据：服务端按工作区一侧标出子模块（isSubmodule）与已不存在的文件（isMissingInWorkingTree）。
 */
export function canOpenGitPaneChangeInViewer(
  change: Pick<
    GitFileChange,
    "repoRelativePath" | "kind" | "isUntracked" | "isSubmodule" | "isMissingInWorkingTree"
  >,
): boolean {
  return (
    change.kind !== "deleted" &&
    !isCollapsedUntrackedDirectory(change) &&
    !change.isSubmodule &&
    !change.isMissingInWorkingTree
  );
}

/** `discardPaths` 的 staged 参数：staged 来源要同时恢复 index 与工作区。 */
export function isGitPaneDiscardStaged(sourceId: GitChangeSourceId): boolean {
  return sourceId === "staged";
}
