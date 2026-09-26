import type { DiffLineAnnotation, FileDiffOptions } from "@pierre/diffs";
import { nanoid } from "nanoid";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeCommentAnnotation, CommentDraft } from "@/components/ui/code-viewer.js";
import type { DiffViewerSelectedLineRange } from "@/components/ui/diff-viewer.js";
import {
  getDiffCommentSelectedText,
  normalizeDiffCommentRange,
  toCodeCommentSide,
  type DiffCommentRange,
  type DiffLineSelection,
} from "@/GitPane/diffComments.js";
import { useCodeCommentLabels } from "@/hooks/useCodeCommentLabels.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  dispatchCodeCommentAddToChat,
  dispatchCodeCommentRemoveFromChat,
  isCodeCommentMarkedRemoved,
  type CodeCommentPreview,
} from "@/lib/codeCommentContext.js";
import { useCodeCommentPreviewStore } from "@/store/codeCommentPreviewStore.js";

/** 草稿在开始时就记下引用的代码，避免 diff 刷新后提交时引用了不同的内容。 */
type DiffCommentDraft = DiffCommentRange & { selectedText: string };

type DiffCommentAnnotationMetadata =
  | { kind: "draft"; range: DiffCommentRange }
  | { kind: "comment"; comment: CodeCommentPreview };

const EMPTY_PREVIEWS: CodeCommentPreview[] = [];

function isDiffCommentAnnotationMetadata(value: unknown): value is DiffCommentAnnotationMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    ((value as DiffCommentAnnotationMetadata).kind === "draft" ||
      (value as DiffCommentAnnotationMetadata).kind === "comment")
  );
}

export interface GitPaneDiffCommentTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 文件绝对路径，与文件预览的评论分桶一致。 */
  sourcePath: string;
  /** 新侧是否就是工作区文件（unstaged 来源）；只有这时才与文件预览共享行内评论。 */
  sharesWorkingTree: boolean;
  sourceTitle: string;
  beforeContent: string | null;
  afterContent: string | null;
  patch: string | null;
}

/**
 * Review diff 行评论：草稿是卡片局部状态，提交后走既有的输入框评论附件与预览 store。
 * 规范：docs/specs/git-review-pane-diff-comments.md
 */
export function useGitPaneDiffComments(target: GitPaneDiffCommentTarget | null): {
  options: FileDiffOptions<unknown> | undefined;
  lineAnnotations: DiffLineAnnotation<unknown>[] | undefined;
  renderAnnotation: ((annotation: DiffLineAnnotation<unknown>) => ReactNode) | undefined;
  selectedLines: DiffViewerSelectedLineRange | null;
} {
  const { intl } = useZCodeIntl();
  const labels = useCodeCommentLabels();
  const [draft, setDraft] = useState<DiffCommentDraft | null>(null);
  const [draftText, setDraftText] = useState("");
  const targetRef = useRef(target);
  targetRef.current = target;
  const enabled = target !== null;
  // 修复原因：卡片折叠后草稿状态仍保留，重新展开会出现旧草稿。修复依据：target 为空（折叠/不可评论）时清空。
  useEffect(() => {
    if (!enabled) {
      setDraft(null);
      setDraftText("");
    }
  }, [enabled]);
  const bucket = target?.sharesWorkingTree
    ? {
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
        sourcePath: target.sourcePath,
      }
    : null;
  const bucketWorkspacePath = bucket?.workspacePath;
  const bucketWorkspaceIdentity = bucket?.workspaceIdentity;
  const bucketSourcePath = bucket?.sourcePath;
  const previews = useCodeCommentPreviewStore((state) =>
    bucketWorkspacePath && bucketSourcePath
      ? state.getComments({
          workspacePath: bucketWorkspacePath,
          workspaceIdentity: bucketWorkspaceIdentity,
          sourcePath: bucketSourcePath,
        })
      : EMPTY_PREVIEWS,
  );
  const addPreview = useCodeCommentPreviewStore((state) => state.addComment);
  const removePreview = useCodeCommentPreviewStore((state) => state.removeComment);

  const startDraft = useCallback((selection: DiffLineSelection | null) => {
    const range = selection ? normalizeDiffCommentRange(selection) : null;
    const current = targetRef.current;
    if (!range || !current) {
      return;
    }
    // 修复原因：之前在提交时才按当前 diff 取文本，自动刷新改变内容后会引用与所选不同的代码。
    // 修复依据：开始草稿时按所选侧取文本并随草稿保存。
    const selectedText = getDiffCommentSelectedText(
      {
        contents: range.side === "deletions" ? current.beforeContent : current.afterContent,
        patch: current.patch,
      },
      range,
    );
    setDraft({ ...range, selectedText });
    setDraftText("");
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDraftText("");
  }, []);

  const submitDraft = useCallback(() => {
    if (!target || !draft) {
      return;
    }
    const { selectedText } = draft;
    if (!selectedText.trim()) {
      return;
    }
    const id = nanoid();
    const side = toCodeCommentSide(draft.side);
    const comment = draftText.trim();
    dispatchCodeCommentAddToChat({
      id,
      side,
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      sourcePath: target.sourcePath,
      sourceTitle: target.sourceTitle,
      startLine: draft.startLine,
      endLine: draft.endLine,
      selectedText,
      comment,
      contextLabel: intl.formatMessage({ id: "codeViewer.comment.contextLabel" }),
      commentLabel: intl.formatMessage({ id: "codeViewer.comment.commentLabel" }),
    });
    setDraft(null);
    setDraftText("");
    // 旧版本（L 侧）或非工作区新侧（staged/branch）的行号无法与工作区文件对齐，只进入输入框附件。
    if (
      side !== "R" ||
      !target.sharesWorkingTree ||
      isCodeCommentMarkedRemoved({
        id,
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
      })
    ) {
      return;
    }
    addPreview({
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      sourcePath: target.sourcePath,
      comment: {
        id,
        sourcePath: target.sourcePath,
        sourceTitle: target.sourceTitle,
        startLine: draft.startLine,
        endLine: draft.endLine,
        selectedText,
        comment,
      },
    });
  }, [addPreview, draft, draftText, intl, target]);

  const deleteComment = useCallback(
    (id: string) => {
      if (!target) {
        return;
      }
      removePreview({
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
        sourcePath: target.sourcePath,
        id,
      });
      dispatchCodeCommentRemoveFromChat({
        id,
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
      });
    },
    [removePreview, target],
  );

  const options = useMemo<FileDiffOptions<unknown> | undefined>(
    () =>
      enabled
        ? {
            enableLineSelection: true,
            enableGutterUtility: true,
            lineHoverHighlight: "both",
            onLineSelectionEnd: startDraft,
            onGutterUtilityClick: startDraft,
          }
        : undefined,
    [enabled, startDraft],
  );

  const lineAnnotations = useMemo<DiffLineAnnotation<unknown>[] | undefined>(() => {
    if (!enabled) {
      return undefined;
    }
    const annotations: DiffLineAnnotation<unknown>[] = previews.map((comment) => ({
      side: "additions",
      lineNumber: comment.endLine,
      metadata: { kind: "comment", comment } satisfies DiffCommentAnnotationMetadata,
    }));
    if (draft) {
      annotations.push({
        side: draft.side,
        lineNumber: draft.endLine,
        metadata: {
          kind: "draft",
          range: { side: draft.side, startLine: draft.startLine, endLine: draft.endLine },
        } satisfies DiffCommentAnnotationMetadata,
      });
    }
    return annotations;
  }, [draft, enabled, previews]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<unknown>): ReactNode => {
      const metadata = annotation.metadata;
      if (!isDiffCommentAnnotationMetadata(metadata)) {
        return null;
      }
      if (metadata.kind === "comment") {
        return (
          <CodeCommentAnnotation
            comment={metadata.comment}
            labels={labels}
            onDelete={deleteComment}
          />
        );
      }
      return (
        <CommentDraft
          range={metadata.range}
          labels={labels}
          value={draftText}
          onValueChange={setDraftText}
          onSubmit={submitDraft}
          onCancel={cancelDraft}
        />
      );
    },
    [cancelDraft, deleteComment, draftText, labels, submitDraft],
  );

  return {
    options,
    lineAnnotations,
    renderAnnotation: enabled ? renderAnnotation : undefined,
    selectedLines: draft ? { start: draft.startLine, end: draft.endLine, side: draft.side } : null,
  };
}
