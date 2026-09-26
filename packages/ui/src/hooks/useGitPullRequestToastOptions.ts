import { useCallback } from "react";
import type { ToastOptions } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

/** 带操作按钮的 toast 需要给用户足够时间点击。 */
const PULL_REQUEST_TOAST_DURATION_MS = 10_000;

/**
 * 推送成功后为 toast 附加“创建拉取请求”操作。规范：docs/specs/git-pull-request-link.md
 * 链接查询失败只记日志并返回 undefined，推送结果提示照常显示。
 */
export function useGitPullRequestToastOptions(workspacePath: string) {
  const { gitService } = useServices();
  const platform = usePlatform();
  const { intl } = useZCodeIntl();

  return useCallback(async (): Promise<ToastOptions | undefined> => {
    try {
      const link = await gitService.getPullRequestLink({ workspacePath });
      if (!link) {
        return undefined;
      }
      return {
        actionLabel: intl.formatMessage({
          id:
            link.provider === "gitlab"
              ? "git.actionMenu.pullRequest.createMergeRequest"
              : "git.actionMenu.pullRequest.create",
        }),
        onAction: () => platform.openExternal(link.url),
        durationMs: PULL_REQUEST_TOAST_DURATION_MS,
        // 默认样式的 toast 只渲染文字、不渲染操作按钮；带操作的提示必须使用 notice 样式。
        variant: "info",
      };
    } catch (error: unknown) {
      logger.warn("[GitActionMenu] 读取拉取请求链接失败", {
        workspacePath,
        error: getErrorMessage(error),
      });
      return undefined;
    }
  }, [gitService, intl, platform, workspacePath]);
}
