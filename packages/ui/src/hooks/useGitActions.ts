import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

type GitPathMutationKind = "stage" | "unstage" | "discard";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

/**
 * Review 面板的文件级 Git 写操作（暂存 / 取消暂存 / 丢弃）。
 * 规范：docs/specs/git-review-pane-file-actions.md
 *
 * - 唯一写入路径：`gitService.{stagePaths,unstagePaths,discardPaths}`，不保存乐观副本；
 * - 同一时刻只允许一个请求（ref 锁防止同一帧内的重复点击）；
 * - 请求结束（成功或失败）后调用 `onSettled`，由调用方触发 Git 快照刷新。
 */
export function useGitActions(options: { workspacePath: string; onSettled: () => void }) {
  const { workspacePath, onSettled } = options;
  const { gitService } = useServices();
  const { intl } = useZCodeIntl();
  const requestConfirmation = useConfirmDialog();
  const inFlightRef = useRef(false);
  const [pending, setPending] = useState(false);

  const runMutation = useCallback(
    async (kind: GitPathMutationKind, paths: string[], mutate: () => Promise<void>) => {
      if (inFlightRef.current || paths.length === 0) {
        return false;
      }
      inFlightRef.current = true;
      setPending(true);
      logger.info(`[GitPane] ${kind} 开始`, { workspacePath, count: paths.length });
      try {
        await mutate();
        return true;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        logger.warn(`[GitPane] ${kind} 失败`, {
          workspacePath,
          count: paths.length,
          error: message,
        });
        toast(intl.formatMessage({ id: "git.fileAction.failed" }, { message }), {
          variant: "warning",
        });
        return false;
      } finally {
        inFlightRef.current = false;
        setPending(false);
        onSettled();
      }
    },
    [intl, onSettled, workspacePath],
  );

  const stagePaths = useCallback(
    (paths: string[]) =>
      runMutation("stage", paths, () => gitService.stagePaths({ workspacePath, paths })),
    [gitService, runMutation, workspacePath],
  );

  const unstagePaths = useCallback(
    (paths: string[]) =>
      runMutation("unstage", paths, () => gitService.unstagePaths({ workspacePath, paths })),
    [gitService, runMutation, workspacePath],
  );

  const discardPaths = useCallback(
    async (paths: string[], discardOptions: { staged: boolean; untrackedCount: number }) => {
      if (inFlightRef.current || paths.length === 0) {
        return false;
      }
      const confirmed = await requestConfirmation({
        title: intl.formatMessage(
          { id: "git.fileAction.discardConfirmTitle" },
          { count: paths.length },
        ),
        description:
          discardOptions.untrackedCount > 0
            ? intl.formatMessage(
                { id: "git.fileAction.discardConfirmUntrackedDescription" },
                { untracked: discardOptions.untrackedCount },
              )
            : intl.formatMessage({ id: "git.fileAction.discardConfirmDescription" }),
        confirmLabel: intl.formatMessage({ id: "git.action.discard" }),
        confirmVariant: "destructive",
      });
      if (!confirmed) {
        return false;
      }
      return await runMutation("discard", paths, () =>
        gitService.discardPaths({ workspacePath, paths, staged: discardOptions.staged }),
      );
    },
    [gitService, intl, requestConfirmation, runMutation, workspacePath],
  );

  return { pending, stagePaths, unstagePaths, discardPaths };
}
