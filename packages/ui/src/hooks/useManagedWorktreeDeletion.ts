import { useCallback, useEffect, useState } from "react";
import type { GitManagedWorktree } from "@zcode/shared";
import type { IGitService, ITerminalService } from "@zcode/services";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorKindForLog, getErrorMessage } from "@/lib/errorMessage.js";
import { removeManagedWorktree } from "@/lib/worktreeRemoval.js";
import { logger } from "@/logger.js";

/**
 * 侧栏“删除 worktree”：只对 ZCode 创建的本地 worktree 可用。规范：docs/specs/git-worktree-task.md
 * 确认运行中对话与释放 workspace 入口复用侧栏“移除”的同一逻辑，由调用方传入。
 */
export function useManagedWorktreeDeletion(options: {
  /** 该 workspace 行自己的（本地）Git 服务，而不是当前激活 workspace 的服务。 */
  gitService: IGitService;
  /** 同一本地 Host 的终端服务：删除前结束该 worktree 内的终端并等待退出，删除尝试结束后解除新建封锁。 */
  terminalService: Pick<ITerminalService, "disposeUnderPath" | "releasePathBlock">;
  /** 除本入口外、路径位于该 worktree 内的其它本地 workspace 入口（显示名）。 */
  listOtherEntriesInWorktree: (worktreePath: string) => Promise<string[]>;
  workspacePath: string;
  /** 菜单打开且为本地 workspace 时才查询，避免每一行都常驻 git 调用。 */
  enabled: boolean;
  confirmRemovingRunningWorkspace: () => Promise<boolean>;
  /** 关闭入口并释放 runtime；释放结束后 resolve 为是否成功。 */
  releaseWorkspaceEntry: (options?: { scanReservedNames?: boolean }) => Promise<boolean>;
}) {
  const {
    gitService,
    terminalService,
    listOtherEntriesInWorktree,
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

  // 修复原因：同一 worktree 可能还以其它入口打开（如根目录与某个子目录），只释放当前入口时，其它入口的 Agent
  // 仍以 worktree 内目录为 cwd：Windows 上删除失败，POSIX 上会在未确认的活动 workspace 下删掉检出。
  // 修复依据：存在其它入口时拒绝删除并提示先关闭它们（确认前与释放前各检查一次）。
  const refuseIfOtherEntriesOpen = useCallback(
    async (worktreePath: string): Promise<boolean> => {
      const others = await listOtherEntriesInWorktree(worktreePath).catch(() => []);
      if (others.length === 0) return false;
      toast(
        intl.formatMessage(
          { id: "git.worktree.delete.otherEntriesOpen" },
          { names: others.join(", ") },
        ),
        { variant: "warning" },
      );
      return true;
    },
    [intl, listOtherEntriesInWorktree],
  );

  const deleteWorktree = useCallback(async () => {
    if (!managedWorktree || (await refuseIfOtherEntriesOpen(managedWorktree.worktreePath))) {
      return;
    }
    if (!(await confirmRemovingRunningWorkspace())) {
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
      logger.warn("[WorktreeDeletion] 读取 worktree 状态失败", {
        errorKind: getErrorKindForLog(error),
      });
      toast(
        intl.formatMessage({ id: "git.worktree.delete.failed" }, { error: getErrorMessage(error) }),
      );
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
    // git worktree remove 失败甚至只删掉一部分文件；关闭标签触发的终端回收也是异步、不等待进程退出的。
    // 修复依据：先由终端服务结束该目录下的终端并等待其退出，再关闭入口并等待 runtime 释放完成，最后删除目录；
    // 失败时提示并提供重试。删除流程不做 Windows 保留名扫描：目录即将删除，扫描还会在删除时占用目录。
    const worktreePath = managedWorktree.worktreePath;
    await removeManagedWorktree({
      gitService,
      terminalService,
      releaseWorkspaceEntry,
      refuseIfOtherEntriesOpen: () => refuseIfOtherEntriesOpen(worktreePath),
      notify: toast,
      intl,
      workspacePath,
      worktreePath,
      branchName,
      force,
    });
  }, [
    confirmDialog,
    confirmRemovingRunningWorkspace,
    gitService,
    intl,
    managedWorktree,
    refuseIfOtherEntriesOpen,
    releaseWorkspaceEntry,
    terminalService,
    workspacePath,
  ]);

  return { managedWorktree, deleteWorktree };
}
