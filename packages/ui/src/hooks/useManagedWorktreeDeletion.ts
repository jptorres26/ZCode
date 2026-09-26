import { useCallback, useEffect, useState } from "react";
import type { GitManagedWorktree, GitRemoveWorktreeResult } from "@zcode/shared";
import type { IGitService } from "@zcode/services";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

type ZCodeIntl = ReturnType<typeof useZCodeIntl>["intl"];

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
  /** 关闭入口并释放 runtime；runtime 释放完成后 resolve。 */
  releaseWorkspaceEntry: () => Promise<void>;
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
    if (!managedWorktree || !(await confirmRemovingRunningWorkspace())) {
      return;
    }
    const branchName = managedWorktree.branchName ?? "";
    const confirmed = await confirmDialog({
      title: intl.formatMessage({ id: "git.worktree.delete.confirmTitle" }),
      description: intl.formatMessage(
        { id: "git.worktree.delete.confirmDescription" },
        { path: managedWorktree.worktreePath, branchName },
      ),
      confirmLabel: intl.formatMessage({ id: "git.worktree.delete.confirm" }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }
    let force: boolean;
    try {
      // 所有确认都在释放 runtime 之前完成：按删除前一刻的状态决定是否需要“丢弃改动”确认。
      const current = await gitService.getManagedWorktree({ workspacePath });
      if (!current) {
        toast(intl.formatMessage({ id: "git.worktree.delete.failed" }, { error: "not-managed" }));
        return;
      }
      force = current.hasUncommittedChanges;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn("[WorktreeDeletion] 读取 worktree 状态失败", { workspacePath, error: message });
      toast(intl.formatMessage({ id: "git.worktree.delete.failed" }, { error: message }));
      return;
    }
    if (
      force &&
      !(await confirmDialog({
        title: intl.formatMessage({ id: "git.worktree.delete.dirtyTitle" }),
        description: intl.formatMessage({ id: "git.worktree.delete.dirtyDescription" }),
        confirmLabel: intl.formatMessage({ id: "git.worktree.delete.forceConfirm" }),
        cancelLabel: intl.formatMessage({ id: "common.cancel" }),
        confirmVariant: "destructive",
      }))
    ) {
      return;
    }
    // 修复原因：先删目录再释放时，Windows 上以该目录为 cwd 的 Agent/终端进程会占用目录，
    // git worktree remove 失败甚至只删掉一部分文件。修复依据：先关闭入口（终端随 workspace 关闭回收）
    // 并等待 runtime 释放完成，再删除目录；失败时提示并提供重试。
    await releaseWorkspaceEntry();
    await removeReleasedWorktree({
      gitService,
      workspacePath,
      worktreePath: managedWorktree.worktreePath,
      branchName,
      force,
      intl,
    });
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

/** 入口已关闭后删除目录；侧栏行此时已卸载，因此不依赖组件状态，失败时由 toast 提供重试。 */
async function removeReleasedWorktree(params: {
  gitService: IGitService;
  workspacePath: string;
  worktreePath: string;
  branchName: string;
  force: boolean;
  intl: ZCodeIntl;
}): Promise<void> {
  const { gitService, workspacePath, worktreePath, branchName, force, intl } = params;
  const result: GitRemoveWorktreeResult = await gitService
    .removeWorktree({ workspacePath, force })
    .catch((error: unknown) => ({
      ok: false as const,
      reason: "failed" as const,
      detail: getErrorMessage(error),
    }));
  if (result.ok) {
    toast(intl.formatMessage({ id: "git.worktree.delete.done" }, { branchName }));
    return;
  }
  const error = result.detail ?? result.reason;
  logger.warn("[WorktreeDeletion] 删除 worktree 失败", { workspacePath, error });
  toast(
    intl.formatMessage(
      { id: "git.worktree.delete.failedAfterRelease" },
      { path: worktreePath, branchName, error },
    ),
    {
      variant: "warning",
      durationMs: 15_000,
      actionLabel: intl.formatMessage({ id: "git.worktree.delete.retry" }),
      onAction: () => {
        void removeReleasedWorktree(params);
      },
    },
  );
}
