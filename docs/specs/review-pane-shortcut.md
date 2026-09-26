# 切换 Review 面板的快捷键

> 英文版：[review-pane-shortcut.en.md](review-pane-shortcut.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 可以用快捷键打开 / 关闭 diff 面板。ZCode 只有通用的“切换右侧面板”（`CmdOrCtrl+Alt+B`，
恢复上次的标签）和标题栏的 Review 按钮，没有直达 Review 的快捷键。

## 规则

- 在 `SHORTCUT_COMMANDS`（`packages/shared/src/shortcutCommands.ts`，快捷键唯一数据源）中新增
  `toggleReviewPane`，`channel: "window"`，全局作用域，默认 `CmdOrCtrl+Shift+G`
  （与 VS Code 的“源代码管理”一致）。
- 处理器复用标题栏 Review 按钮的同一入口 `handleToggleGitIfWritable`，经 `runVisibleWorkspaceCommand`
  执行，不新增状态或写入路径。只读工作区沿用该入口的只读判断（不执行）；办公模式（不提供 Review）下
  处理器为 `null`，按键放行给浏览器。
- 设置页快捷键列表自动展示该命令，文案 `settings.shortcuts.command.toggleReviewPane`，`en-US` 与
  `zh-CN` 同步提供；用户可改键，冲突检测沿用既有逻辑。
- 不新增“聚焦输入框”快捷键：全局快捷键在终端获得焦点时同样被捕获，Linux / Windows 上
  `Ctrl+字母` 会吞掉终端控制字符（如 `Ctrl+L` 清屏、`Ctrl+I` 即 Tab），且 `CmdOrCtrl+L` 已在保留键中。

## 验收

- `packages/ui/test/shortcutDefaults.test.ts`：所有全局默认绑定在 Apple 与非 Apple 平台上都不与保留键或
  其它命令冲突；`toggleReviewPane` 默认绑定为 `CmdOrCtrl+Shift+g`。
- Web 开发服务 + Playwright：按 `Ctrl+Shift+G` 打开 Review 面板，再按一次关闭。
