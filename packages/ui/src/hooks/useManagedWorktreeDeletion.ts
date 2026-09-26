import { useCallback, useEffect, useState } from "react";
import type { GitManagedWorktree, GitRemoveWorktreeResult } from "@zcode/shared";
import type { IGitService, ITerminalService } from "@zcode/services";
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
  /** 同一本地 Host 的终端服务：删除前结束该 worktree 内的终端并等待退出，删除尝试结束后解除新建封锁。 */
  terminalService: Pick<ITerminalService, "disposeUnderPath" | "releasePathBlock">;
  /** 除本入口外、路径位于该 worktree 内的其它本地 workspace 入口（显示名）。 */
  listOtherEntriesInWorktree: (worktreePath: string) => Promise<string[]>;
  workspacePath: string;
  /** 菜单打开且为本地 workspace 时才查询，避免每一行都常驻 git 调用。 */
  enabled: boolean;
  confirmRemovingRunningWorkspace: () => Promise<boolean>;
  /** 关闭入口并释放 runtime；runtime 释放完成后 resolve。 */
  releaseWorkspaceEntry: (options?: { scanReservedNames?: boolean }) => Promise<void>;
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
    // git worktree remove 失败甚至只删掉一部分文件；关闭标签触发的终端回收也是异步、不等待进程退出的。
    // 修复依据：先由终端服务结束该目录下的终端并等待其退出，再关闭入口并等待 runtime 释放完成，最后删除目录；
    // 失败时提示并提供重试。删除流程不做 Windows 保留名扫描：目录即将删除，扫描还会在删除时占用目录。
    if (await refuseIfOtherEntriesOpen(managedWorktree.worktreePath)) {
      return;
    }
    const worktreePath = managedWorktree.worktreePath;
    await terminalService.disposeUnderPath({ path: worktreePath }).catch((error: unknown) => {
      logger.warn("[WorktreeDeletion] 结束 worktree 终端失败", {
        workspacePath,
        error: getErrorMessage(error),
      });
    });
    try {
      await releaseWorkspaceEntry({ scanReservedNames: false });
      await removeReleasedWorktree({
        gitService,
        workspacePath,
        worktreePath,
        branchName,
        force,
        intl,
      });
    } finally {
      // 删除尝试结束（成功或失败）后解除新建终端封锁；之后的重试只在 toast 中进行，入口已关闭。
      void terminalService.releasePathBlock({ path: worktreePath }).catch(() => undefined);
    }
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

interface ReleasedWorktreeRemoval {
  gitService: IGitService;
  workspacePath: string;
  worktreePath: string;
  branchName: string;
  force: boolean;
  intl: ZCodeIntl;
}

/**
 * 入口已关闭后删除目录；侧栏行此时已卸载，因此不依赖组件状态，后续确认与重试都通过 toast 操作完成。
 * - dirty：确认后又出现了未提交改动，用户未同意丢弃，提供“仍然删除”（force）。
 * - leftover：git 已撤销登记但目录未删净，重试改为清理剩余目录。
 * - 其它失败：重试同一删除。
 */
async function removeReleasedWorktree(params: ReleasedWorktreeRemoval): Promise<void> {
  const { gitService, workspacePath, force, intl } = params;
  const result: GitRemoveWorktreeResult = await gitService
    .removeWorktree({ workspacePath, force })
    .catch((error: unknown) => ({
      ok: false as const,
      reason: "failed" as const,
      detail: getErrorMessage(error),
    }));
  if (result.ok) {
    toast(
      intl.formatMessage({ id: "git.worktree.delete.done" }, { branchName: params.branchName }),
    );
    return;
  }
  if (result.reason === "dirty") {
    toast(
      intl.formatMessage(
        { id: "git.worktree.delete.dirtyAfterRelease" },
        { path: params.worktreePath, branchName: params.branchName },
      ),
      {
        variant: "warning",
        durationMs: 15_000,
        actionLabel: intl.formatMessage({ id: "git.worktree.delete.forceConfirm" }),
        onAction: () => {
          void removeReleasedWorktree({ ...params, force: true });
        },
      },
    );
    return;
  }
  if (result.reason === "leftover") {
    reportRemovalFailure(params, result.detail ?? result.reason, "leftover", () =>
      removeLeftoverWorktree(params),
    );
    return;
  }
  reportRemovalFailure(params, result.detail ?? result.reason, "failed", () =>
    removeReleasedWorktree(params),
  );
}

async function removeLeftoverWorktree(params: ReleasedWorktreeRemoval): Promise<void> {
  const { gitService, worktreePath, intl } = params;
  const result = await gitService
    .removeWorktreeLeftover({ worktreePath })
    .catch((error: unknown) => ({
      ok: false as const,
      reason: "failed" as const,
      detail: getErrorMessage(error),
    }));
  if (result.ok) {
    toast(
      intl.formatMessage({ id: "git.worktree.delete.done" }, { branchName: params.branchName }),
    );
    return;
  }
  reportRemovalFailure(params, result.detail ?? result.reason, "leftover", () =>
    removeLeftoverWorktree(params),
  );
}

// 修复原因：git 在删除任何内容前就拒绝（如 worktree 被锁定）时，也提示“未能完全删除、重试删除剩余内容”，与事实不符。
// 修复依据：leftover（已部分删除、登记已消失）与普通失败（目录与分支都还在）使用不同文案。
function reportRemovalFailure(
  params: ReleasedWorktreeRemoval,
  error: string,
  kind: "failed" | "leftover",
  retry: () => Promise<void>,
): void {
  const { intl, workspacePath, worktreePath, branchName } = params;
  logger.warn("[WorktreeDeletion] 删除 worktree 失败", { workspacePath, error });
  toast(
    intl.formatMessage(
      {
        id:
          kind === "leftover"
            ? "git.worktree.delete.leftoverAfterRelease"
            : "git.worktree.delete.failedAfterRelease",
      },
      { path: worktreePath, branchName, error },
    ),
    {
      variant: "warning",
      durationMs: 15_000,
      actionLabel: intl.formatMessage({ id: "git.worktree.delete.retry" }),
      onAction: () => {
        void retry();
      },
    },
  );
}
