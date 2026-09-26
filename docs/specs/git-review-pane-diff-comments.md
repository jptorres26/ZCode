# Review 面板 diff 行评论

> 英文版：[git-review-pane-diff-comments.en.md](git-review-pane-diff-comments.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 可以在 Review 面板的 diff 行上留下评论，再交给 Agent 处理。ZCode 的文件预览已经有完整的
代码评论链路（选择行 → 草稿 → 输入框评论附件 → 发送时序列化为 `# Code comments:`），但 Review 面板的
diff 没有接入。本规范只复用这条链路，不新增服务、协议或存储。

## 状态所有者与数据流

| 状态                     | 所有者                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| 草稿（行范围、侧、文本） | `GitPaneChangeCard` 局部状态；卡片折叠或被虚拟列表卸载时丢弃                     |
| 已提交评论（输入框附件） | 既有 `useCodeCommentContexts`（经 `dispatchCodeCommentAddToChat` 事件写入）      |
| 行内展示的已提交评论     | 既有 `useCodeCommentPreviewStore`，与文件预览共用 `(workspace, sourcePath)` 分桶 |

```
选择 diff 行 / 点击行号旁 “+” ──► 草稿注解（CommentDraft）
        │ Cmd/Ctrl+Enter 提交（Esc 取消）
        ▼
dispatchCodeCommentAddToChat(payload + side)
        ├──► 输入框评论附件（既有，发送时生成 “Side: L|R”）
        └──► side = R 时 addComment 到预览 store ──► Review diff 与文件预览都行内展示
删除行内评论 ──► removeComment + dispatchCodeCommentRemoveFromChat（与文件预览一致）
```

## 规则

- 仅富 diff（`MultiFileDiff` / `PatchDiff`）支持评论；超大 diff 的轻量预览不支持。
- 行范围：`@pierre/diffs` 给出的行号即该侧文件的真实行号。起止在同一侧时取该侧 `[start, end]`
  （升序）；跨侧选择（统一视图中同时选中删除行与新增行，或并排视图跨栏）时，只取结束行所在侧的结束行。
- 侧：`deletions` → `L`（旧版本行号），`additions` → `R`（新版本行号）。`CodeCommentPayload` 新增可选
  `side?: "L" | "R"`，缺省为 `R`；序列化时写入 `Side:`，解析时读取 `Side:`（缺失视为 `R`），保持往返一致。
- 选中文本：`MultiFileDiff` 从对应侧的完整内容截取；`PatchDiff` 从 patch 的 hunk 中按侧重建行号 → 文本。
  文本在**开始草稿时**截取并随草稿保存，diff 自动刷新不会改变引用的代码；取不到任何非空文本时不提交（与文件预览一致）。
- 草稿在卡片折叠（不可评论）时清空。
- 载荷：`sourcePath` 为文件绝对路径（按 workspace 的路径分隔符归一，Windows 下不产生 `\` 与 `/` 混合），`sourceTitle` 为文件名，`workspacePath` / `workspaceIdentity` 取 Review
  面板所在工作区。
- 只有 `unstaged` 来源的新侧是工作区文件：此时 `R` 侧评论同时写入预览 store，并在 Review diff 的新增侧行内展示，
  可删除，预览 store 中已有的评论也在此展示。`L` 侧评论、以及 `staged`（新侧为 index）/ `branch`（新侧为 HEAD）
  来源的评论只进入输入框附件，因为它们的行号不能与工作区文件预览对齐。
- 文案复用 `codeViewer.comment.*`，标签由共享 hook `useCodeCommentLabels` 生成，文件预览同步改用该 hook。

## 验收

- `packages/ui/test/gitPaneDiffComments.test.ts`：跨侧选择的归一、patch 按侧取行、`Side:` 的序列化与解析往返。
- Web 开发服务 + Playwright：在 Review 展开文件 diff，点击新增行的行号 “+”，输入评论后提交，输入框出现评论附件，
  diff 中出现该评论；删除后附件消失。
