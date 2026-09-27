import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorKindForLog } from "@/lib/errorMessage.js";
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
      logger.info(`[GitPane] ${kind} 开始`, { count: paths.length });
      try {
        await mutate();
        return true;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        // 只记录错误类别：git 的错误信息含文件路径。
        logger.warn(`[GitPane] ${kind} 失败`, {
          count: paths.length,
          errorKind: getErrorKindForLog(error),
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
    async (
      paths: string[],
      discardOptions: { staged: boolean; deletedFilePaths: string[]; deletedFolderPaths: string[] },
    ) => {
      if (inFlightRef.current || paths.length === 0) {
        return false;
      }
      const deletedFileCount = discardOptions.deletedFilePaths.length;
      const deletedFolderCount = discardOptions.deletedFolderPaths.length;
      const confirmed = await requestConfirmation({
        title: intl.formatMessage(
          { id: "git.fileAction.discardConfirmTitle" },
          { count: paths.length },
        ),
        description:
          deletedFolderCount > 0
            ? intl.formatMessage(
                {
                  id:
                    deletedFileCount > 0
                      ? "git.fileAction.discardConfirmDeletesFoldersDescription"
                      : "git.fileAction.discardConfirmDeletesFoldersOnlyDescription",
                },
                { fileCount: deletedFileCount, folderCount: deletedFolderCount },
              )
            : deletedFileCount > 0
              ? intl.formatMessage(
                  { id: "git.fileAction.discardConfirmDeletesDescription" },
                  { count: deletedFileCount },
                )
              : intl.formatMessage({ id: "git.fileAction.discardConfirmDescription" }),
        confirmLabel: intl.formatMessage({ id: "git.action.discard" }),
        confirmVariant: "destructive",
      });
      if (!confirmed) {
        return false;
      }
      // 修复原因：确认文案按确认前的快照计算删除数量；确认期间文件状态变化后，服务端重新规划可能删除确认中未提示的文件。
      // 修复依据：把确认过的删除路径随请求传给服务端，由服务端在执行前核对，超出时拒绝整个丢弃。
      return await runMutation("discard", paths, () =>
        gitService.discardPaths({
          workspacePath,
          paths,
          staged: discardOptions.staged,
          confirmedDeletionPaths: [
            ...discardOptions.deletedFilePaths,
            ...discardOptions.deletedFolderPaths,
          ],
        }),
      );
    },
    [gitService, intl, requestConfirmation, runMutation, workspacePath],
  );

  return { pending, stagePaths, unstagePaths, discardPaths };
}
