import { useMemo } from "react";
import type { CodeCommentLabels } from "@/components/ui/code-viewer.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 代码评论草稿与注解的文案；文件预览与 Review diff 共用，避免两份标签漂移。 */
export function useCodeCommentLabels(): CodeCommentLabels {
  const { intl } = useZCodeIntl();
  return useMemo(
    () => ({
      addComment: intl.formatMessage({ id: "codeViewer.comment.add" }),
      addCommentTooltip: intl.formatMessage({ id: "codeViewer.comment.addTooltip" }),
      commentPlaceholder: intl.formatMessage({ id: "codeViewer.comment.placeholder" }),
      submitComment: intl.formatMessage({ id: "codeViewer.comment.submit" }),
      cancelComment: intl.formatMessage({ id: "common.cancel" }),
      deleteComment: intl.formatMessage({ id: "codeViewer.comment.delete" }),
      commentLine: intl.formatMessage({ id: "codeViewer.comment.line" }),
      commentRange: intl.formatMessage({ id: "codeViewer.comment.range" }),
    }),
    [intl],
  );
}
