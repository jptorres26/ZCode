# Review pane diff line comments

> Chinese version: [git-review-pane-diff-comments.md](git-review-pane-diff-comments.md). The Chinese file is normative; keep both in sync.

## Background

Codex desktop lets you leave comments on diff lines in the Review pane and hand them to the agent.
ZCode's file viewer already has the whole code comment flow: select lines, write a draft, the
comment becomes a composer attachment, and sending serializes it as `# Code comments:`. The Review
pane's diffs were never wired into it. This spec reuses that flow only. It adds no service,
protocol or storage.

## State owners and data flow

| State                                     | Owner                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Draft (line range, side, text)            | Local state in `GitPaneChangeCard`; dropped when the card collapses or the virtual list unmounts it    |
| Submitted comments (composer attachments) | The existing `useCodeCommentContexts`, written through the `dispatchCodeCommentAddToChat` event        |
| Submitted comments shown inline           | The existing `useCodeCommentPreviewStore`, sharing the file viewer's `(workspace, sourcePath)` buckets |

```
select diff lines / click the "+" next to a line number ──► draft annotation (CommentDraft)
        │ Cmd/Ctrl+Enter submits (Esc cancels)
        ▼
dispatchCodeCommentAddToChat(payload + side)
        ├──► composer attachment (existing; sending emits "Side: L|R")
        └──► for side R, addComment to the preview store ──► shown inline in the Review diff and the file viewer
delete an inline comment ──► removeComment + dispatchCodeCommentRemoveFromChat (same as the file viewer)
```

## Rules

- Only rich diffs (`MultiFileDiff` / `PatchDiff`) take comments; the lightweight preview used for
  very large diffs does not.
- Line range: the line numbers from `@pierre/diffs` are the real line numbers of that side's file.
  When the selection starts and ends on the same side, the range is `[start, end]` on that side, in
  ascending order. When it crosses sides (deleted and added lines together in the unified view, or
  across columns in the split view), only the end line on the end side is used.
- Side: `deletions` → `L` (old version line numbers), `additions` → `R` (new version line numbers).
  `CodeCommentPayload` gets an optional `side?: "L" | "R"`, defaulting to `R`. Serialization writes
  `Side:` and parsing reads it (missing means `R`), so the round trip is lossless.
- Selected text: `MultiFileDiff` slices it from that side's full content; `PatchDiff` rebuilds a
  line-number → text map per side from the patch hunks. If no non-empty text is found, nothing is
  submitted (same as the file viewer).
- Payload: `sourcePath` is the file's absolute path, `sourceTitle` its file name, and
  `workspacePath` / `workspaceIdentity` come from the Review pane's workspace.
- `R` comments are also added to the preview store and shown inline on the added side of the
  Review diff, where they can be deleted. `L` comments only become composer attachments, because
  old-version line numbers can't be lined up with the working-tree file in the file viewer.
- Strings reuse `codeViewer.comment.*`. The labels come from a shared `useCodeCommentLabels` hook,
  which the file viewer now uses too.

## Acceptance

- `packages/ui/test/gitPaneDiffComments.test.ts`: cross-side selection normalization, per-side line
  extraction from a patch, and the `Side:` serialize/parse round trip.
- Web dev server + Playwright: expand a file's diff in Review, click the "+" next to an added line,
  type a comment and submit; a comment attachment appears in the composer and the comment appears
  in the diff; deleting it removes the attachment.
