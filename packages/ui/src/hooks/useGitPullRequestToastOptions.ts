import { useCallback } from "react";
import type { GitPullRequestLink } from "@zcode/shared";
import type { ToastOptions } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 带操作按钮的 toast 需要给用户足够时间点击。 */
const PULL_REQUEST_TOAST_DURATION_MS = 10_000;

/**
 * 推送成功后为 toast 附加“创建拉取请求”操作。规范：docs/specs/git-pull-request-link.md
 * 链接随推送结果返回（取自这次推送实际推送的分支与地址）；没有链接时返回 undefined，推送结果提示照常显示。
 */
export function useGitPullRequestToastOptions() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();

  return useCallback(
    (link: GitPullRequestLink | null): ToastOptions | undefined => {
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
    },
    [intl, platform],
  );
}
