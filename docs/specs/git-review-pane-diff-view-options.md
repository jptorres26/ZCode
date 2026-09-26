# Review 面板 diff 视图选项（并排 / 统一、自动换行）

> 英文版：[git-review-pane-diff-view-options.en.md](git-review-pane-diff-view-options.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 的 Review 面板可以在统一视图与并排视图之间切换，并切换长行换行。
ZCode 的富 diff 组件 `DiffViewer` 把 `diffStyle: "unified"` 与 `overflow: "scroll"` 写死，
全局设置“长行自动换行”也只作用于轻量 diff 与代码块，对富 diff 无效。

## 状态所有者

| 状态                                                          | 所有者                                                            | 持久化                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Review 面板 diff 布局 `reviewDiffStyle: "unified" \| "split"` | `useZCodeStore().codePreviewSettings`（`setCodePreviewSettings`） | 与其它代码预览设置相同，写入本机 localStorage；默认 `"unified"`，读取到非法值时回退默认值 |
| 全局“长行自动换行” `wrapLongLines`                            | 同上（既有字段）                                                  | 同上                                                                                      |
| Review 面板换行覆盖                                           | `GitPane` 组件内局部状态 `wrapOverride: boolean \| null`          | 不持久化，与文件预览的“自动换行”菜单项语义一致                                            |

- Review 面板实际换行 = `wrapOverride ?? codePreviewSettings.wrapLongLines`。
- 不新增服务、不经 RPC；这些都是纯展示偏好，不影响 Git 数据与 Agent 行为。

## 接口

- `DiffViewer` 新增可选 props：`diffStyle?: "unified" | "split"`（默认 `"unified"`）与
  `wrapLongLines?: boolean`（默认 `false`，对应 `overflow: "wrap" | "scroll"`）。
  调用方传入的 `options` 仍可覆盖二者。
- 文件预览中的富 diff（`previewPaneContent`、`previewPanePatchFallbackContent`）传入全局
  `wrapLongLines`，使全局设置对所有富 diff 生效；它们保持统一视图。

## 交互

- Review 面板头部在“刷新”旁增加图标按钮“Diff 视图选项”，打开菜单：
  - “布局”单选：统一 / 并排，写入 `reviewDiffStyle`；
  - “自动换行”勾选项，写入 `wrapOverride`。
- 窄面板：面板宽度小于 640px（含手机 Web 侧栏）时，实际布局强制为统一视图，菜单中“并排”禁用并
  提示“加宽面板后可使用并排视图”；保存的偏好不变，面板变宽后自动恢复并排。
  宽度由 `ResizeObserver` 测量 Review 面板根节点。
- 文案 `git.viewOptions.*`，`en-US` 与 `zh-CN` 同步提供。

## 验收

- `packages/ui/test/gitPaneDiffViewOptions.test.ts`：偏好读取的非法值回退、窄面板强制统一、
  换行覆盖优先于全局设置。
- Web 开发服务 + Playwright：展开一个文件的 diff，切换为并排后出现左右两栏；打开自动换行后长行
  不再产生横向滚动；把视口缩窄到手机宽度后“并排”禁用且 diff 为统一视图；刷新页面后布局偏好保留。
