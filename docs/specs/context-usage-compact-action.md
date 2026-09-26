# 上下文用量浮层：手动压缩入口

> 英文版：[context-usage-compact-action.en.md](context-usage-compact-action.en.md)。本文件为规范来源，两者保持同步。

## 背景

输入框工具栏的上下文用量圆环（`ChatContextUsage`）悬停后展示已用 / 上限、分项占比与缓存命中率。
`SessionPane` 已经把 `onSendCompressionCommand` 与 `compressionDisabled` 一路传到该组件，
`chat.contextUsage.compress*` 文案也已存在，但组件从未渲染入口，用户只能手动输入 `/compact`。
上下文接近上限时，Codex desktop 同样提供就地压缩，本规范补上这个入口。

## 行为

- 仅当浮层展示了本任务的上下文用量（`renderableTaskUsage` 存在）且调用方提供了
  `onSendCompressionCommand` 时，在用量进度条下方单独一行显示说明文字与“压缩”按钮
  （标题行已被“上下文窗口 + 用量摘要”占满，说明文字可换行以容纳较长译文）。
- 点击：先关闭浮层，再以 `getContextCompressionCommand(provider)`（当前为 `/compact`）调用
  `onSendCompressionCommand`，与用户手动输入斜杠命令走同一条 `dispatchSlashCommand` 路径；
  不新增状态、不新增协议。
- `compressionDisabled`（输入框禁用或恢复中）时按钮禁用。
- 说明文字为 `chat.contextUsage.compressDescription`（含命令名）。
- 视觉：`Button variant="ghost" size="sm"`，所在浮层为 `rounded-xl`，按钮使用 `rounded-lg`；
  文字 `text-ui-*`，不引入新颜色。

## 验收

- Web 开发服务 + 本地模拟模型：一轮对话后悬停上下文圆环可见“压缩”按钮，点击后浮层关闭，
  模拟模型收到压缩请求，会话中出现压缩结果。
- 新任务草稿（尚无用量）不显示该按钮。
