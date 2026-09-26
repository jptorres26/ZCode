import { useCallback, useEffect, useState } from "react";
import type { GitManagedWorktree } from "@zcode/shared";
import type { IGitService } from "@zcode/services";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

/**
 * 侧栏“删除 worktree”：只对 ZCode 创建的本地 worktree 可用。规范：docs/specs/git-worktree-task.md
 * 确认运行中对话与释放 workspace 入口复用侧栏“移除”的同一逻辑，由调用方传入。
 */
export function useManagedWorktreeDeletion(options: {
  /** 该 workspace 行自己的（本地）Git 服务，而不是当前激活 workspace 的服务。 */
  gitService: IGitService;
  workspacePath: string;
  /** 菜单打开且为本地 workspace 时才查询，避免每一行都常驻 git 调用。 */
  enabled: boolean;
  confirmRemovingRunningWorkspace: () => Promise<boolean>;
  releaseWorkspaceEntry: () => void;
}) {
  const {
    gitService,
    workspacePath,
    enabled,
    confirmRemovingRunningWorkspace,
    releaseWorkspaceEntry,
  } = options;
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const [managedWorktree, setManagedWorktree] = useState<GitManagedWorktree | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let disposed = false;
    void gitService
      .getManagedWorktree({ workspacePath })
      .then((worktree) => {
        if (!disposed) setManagedWorktree(worktree);
      })
      .catch((error: unknown) => {
        logger.debug("[WorktreeDeletion] 读取 worktree 信息失败", {
          workspacePath,
          error: getErrorMessage(error),
        });
        if (!disposed) setManagedWorktree(null);
      });
    return () => {
      disposed = true;
    };
  }, [enabled, gitService, workspacePath]);

  const deleteWorktree = useCallback(async () => {
    const worktree = managedWorktree;
    if (!worktree || !(await confirmRemovingRunningWorkspace())) {
      return;
    }
    const branchName = worktree.branchName ?? "";
    const confirmed = await confirmDialog({
      title: intl.formatMessage({ id: "git.worktree.delete.confirmTitle" }),
      description: intl.formatMessage(
        { id: "git.worktree.delete.confirmDescription" },
        { path: worktree.worktreePath, branchName },
      ),
      confirmLabel: intl.formatMessage({ id: "git.worktree.delete.confirm" }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }
    try {
      let result = await gitService.removeWorktree({ workspacePath });
      if (!result.ok && result.reason === "dirty") {
        const forced = await confirmDialog({
          title: intl.formatMessage({ id: "git.worktree.delete.dirtyTitle" }),
          description: intl.formatMessage({ id: "git.worktree.delete.dirtyDescription" }),
          confirmLabel: intl.formatMessage({ id: "git.worktree.delete.forceConfirm" }),
          cancelLabel: intl.formatMessage({ id: "common.cancel" }),
          confirmVariant: "destructive",
        });
        if (!forced) {
          return;
        }
        result = await gitService.removeWorktree({ workspacePath, force: true });
      }
      if (!result.ok) {
        toast(
          intl.formatMessage(
            { id: "git.worktree.delete.failed" },
            { error: result.detail ?? result.reason },
          ),
        );
        return;
      }
      releaseWorkspaceEntry();
      toast(intl.formatMessage({ id: "git.worktree.delete.done" }, { branchName }));
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn("[WorktreeDeletion] 删除 worktree 失败", { workspacePath, error: message });
      toast(intl.formatMessage({ id: "git.worktree.delete.failed" }, { error: message }));
    }
  }, [
    confirmDialog,
    confirmRemovingRunningWorkspace,
    gitService,
    intl,
    managedWorktree,
    releaseWorkspaceEntry,
    workspacePath,
  ]);

  return { managedWorktree, deleteWorktree };
}
