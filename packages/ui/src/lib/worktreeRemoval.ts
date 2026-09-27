/**
 * 删除 ZCode 创建的 worktree：所有确认完成之后的执行流程。规范：docs/specs/git-worktree-task.md
 * 不依赖 React：侧栏行在关闭入口后即卸载，后续确认与重试都通过 toast 完成。
 */
import type { GitRemoveWorktreeResult } from "@zcode/shared";
import type { IGitService, ITerminalService } from "@zcode/services";
import type { ToastOptions } from "@/components/ui/toast.js";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorKindForLog, getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

type ZCodeIntl = ReturnType<typeof useZCodeIntl>["intl"];

/**
 * 一次删除尝试的依赖与参数。导出供单测使用。
 * @lintignore
 */
export interface WorktreeRemovalParams {
  gitService: Pick<IGitService, "removeWorktree" | "removeWorktreeLeftover">;
  terminalService: Pick<ITerminalService, "disposeUnderPath" | "releasePathBlock">;
  /** 关闭入口并释放 runtime；释放结束后 resolve 为是否成功。可重复调用（关闭已关闭的入口为空操作）。 */
  releaseWorkspaceEntry: (options?: { scanReservedNames?: boolean }) => Promise<boolean>;
  /** 仍有其它入口位于该 worktree 内时提示并返回 true。 */
  refuseIfOtherEntriesOpen: () => Promise<boolean>;
  notify: (message: string, options?: ToastOptions) => void;
  intl: Pick<ZCodeIntl, "formatMessage">;
  workspacePath: string;
  worktreePath: string;
  branchName: string;
  force: boolean;
}

/** 删除步骤：删除 worktree，或清理 git 已撤销登记后的剩余目录（带失败时记录的目录身份）。 */
type RemovalStep = { kind: "worktree" } | { kind: "leftover"; leftoverId: string };

const REMOVE_WORKTREE: RemovalStep = { kind: "worktree" };

const FAILURE_MESSAGE_IDS = {
  failed: "git.worktree.delete.failedAfterRelease",
  leftover: "git.worktree.delete.leftoverAfterRelease",
  release: "git.worktree.delete.releaseFailed",
} as const;

/**
 * 一次删除尝试：检查其它入口 → 结束该目录下的终端并封锁新建 → 关闭入口并等待 runtime 释放 → 删除 → 解除封锁。
 * 修复原因：
 * - runtime 释放失败（如 IPC 或 Host 中断）以前被当作成功，删除会在 Agent 仍以该目录为 cwd 时进行：
 *   POSIX 上删掉活动检出，Windows 上在侧栏入口消失后失败。结束终端的请求失败也有同样问题。
 * - toast 中的重试以前只重新执行删除：若用户在此期间重新打开该 worktree、开了终端又“移除”（移除不等待终端与
 *   runtime 退出），重试会在它们仍以该目录为 cwd 时删除。
 * 修复依据：任一步失败都不删除，保留目录与分支并提供重试；每次尝试（包括每次重试）都完整执行以上步骤，
 * 这些调用都可重复。
 */
export async function removeManagedWorktree(
  params: WorktreeRemovalParams,
  step: RemovalStep = REMOVE_WORKTREE,
): Promise<void> {
  const { terminalService, worktreePath } = params;
  if (await params.refuseIfOtherEntriesOpen()) {
    return;
  }
  try {
    const terminalsStopped = await terminalService.disposeUnderPath({ path: worktreePath }).then(
      () => true,
      (error: unknown) => {
        logger.warn("[WorktreeDeletion] 结束 worktree 终端失败", {
          errorKind: getErrorKindForLog(error),
        });
        return false;
      },
    );
    if (!terminalsStopped || !(await params.releaseWorkspaceEntry({ scanReservedNames: false }))) {
      reportFailure(params, "release", "", () => removeManagedWorktree(params, step));
      return;
    }
    // 修复原因：其它入口只在尝试开始时检查；结束终端与释放 runtime 可能要等几秒，期间新打开的入口不会被发现，
    // 删除会删掉它正在使用的检出。修复依据：释放完成后、删除前再检查一次（终端封锁不阻止新入口的 runtime 启动）。
    if (await params.refuseIfOtherEntriesOpen()) {
      return;
    }
    await (step.kind === "leftover"
      ? removeLeftover(params, step.leftoverId)
      : removeWorktree(params));
  } finally {
    // 删除尝试结束（成功或失败）后解除新建终端封锁；之后的重试会重新封锁。
    void terminalService.releasePathBlock({ path: worktreePath }).catch(() => undefined);
  }
}

/**
 * - dirty：确认后又出现了未提交改动，用户未同意丢弃，提供“仍然删除”（force）。
 * - leftover：git 已撤销登记但目录未删净，重试改为清理剩余目录。
 * - 其它失败：重试同一删除。
 */
async function removeWorktree(params: WorktreeRemovalParams): Promise<void> {
  const { gitService, workspacePath, force, intl } = params;
  const result: GitRemoveWorktreeResult = await gitService
    .removeWorktree({ workspacePath, force })
    .catch((error: unknown) => ({
      ok: false as const,
      reason: "failed" as const,
      detail: getErrorMessage(error),
    }));
  if (result.ok) {
    params.notify(
      intl.formatMessage({ id: "git.worktree.delete.done" }, { branchName: params.branchName }),
    );
    return;
  }
  if (result.reason === "dirty") {
    params.notify(
      intl.formatMessage(
        { id: "git.worktree.delete.dirtyAfterRelease" },
        { path: params.worktreePath, branchName: params.branchName },
      ),
      {
        variant: "warning",
        durationMs: 15_000,
        actionLabel: intl.formatMessage({ id: "git.worktree.delete.forceConfirm" }),
        onAction: () => {
          void removeManagedWorktree({ ...params, force: true });
        },
      },
    );
    return;
  }
  if (result.reason === "leftover") {
    const step: RemovalStep = { kind: "leftover", leftoverId: result.leftoverId };
    reportFailure(params, "leftover", result.detail ?? result.reason, () =>
      removeManagedWorktree(params, step),
    );
    return;
  }
  reportFailure(params, "failed", result.detail ?? result.reason, () =>
    removeManagedWorktree(params),
  );
}

async function removeLeftover(params: WorktreeRemovalParams, leftoverId: string): Promise<void> {
  const { gitService, worktreePath, intl } = params;
  const result = await gitService
    .removeWorktreeLeftover({ worktreePath, leftoverId })
    .catch((error: unknown) => ({
      ok: false as const,
      reason: "failed" as const,
      detail: getErrorMessage(error),
    }));
  if (result.ok) {
    params.notify(
      intl.formatMessage({ id: "git.worktree.delete.done" }, { branchName: params.branchName }),
    );
    return;
  }
  if (result.reason === "not-leftover") {
    // 该路径已不是失败时的那个目录（被替换或换成链接）：不再删除，也不提供重试。
    logger.warn("[WorktreeDeletion] 剩余目录已变化，未清理");
    params.notify(
      intl.formatMessage(
        { id: "git.worktree.delete.leftoverChanged" },
        { path: worktreePath, branchName: params.branchName },
      ),
      { variant: "warning", durationMs: 15_000 },
    );
    return;
  }
  reportFailure(params, "leftover", result.detail ?? result.reason, () =>
    removeManagedWorktree(params, { kind: "leftover", leftoverId }),
  );
}

// 修复原因：git 在删除任何内容前就拒绝（如 worktree 被锁定）时，也提示“未能完全删除、重试删除剩余内容”，与事实不符。
// 修复依据：leftover（已部分删除、登记已消失）、普通失败（目录与分支都还在）与未能停止任务（未尝试删除）使用不同文案。
// 日志只记录失败类别：git 的错误信息含路径，只在提示中展示。
function reportFailure(
  params: WorktreeRemovalParams,
  kind: keyof typeof FAILURE_MESSAGE_IDS,
  error: string,
  retry: () => Promise<void>,
): void {
  const { intl, worktreePath, branchName } = params;
  if (kind !== "release") {
    logger.warn("[WorktreeDeletion] 删除 worktree 失败", { kind });
  }
  params.notify(
    intl.formatMessage(
      { id: FAILURE_MESSAGE_IDS[kind] },
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
