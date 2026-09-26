# 项目操作（Actions）

> 英文版：[project-actions.en.md](project-actions.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 的本地环境可以定义“操作”：一键在内置终端运行项目命令（如测试、开发服务器）。ZCode 已有内置终端
标签与工作区配置文件 `<workspace>/.zcode/config.json`，但没有声明并运行项目命令的入口。本规范复用这两者，
不新增服务或协议。

## 配置（唯一所有者）

`<workspace>/.zcode/config.json` 的顶层 `actions` 数组：

```json
{
  "actions": [
    { "name": "Test", "command": "pnpm test" },
    { "name": "Dev server", "command": "pnpm dev" }
  ]
}
```

- 只读取当前工作区根目录的 `.zcode/config.json`，不向上查找，结果确定。
- `name`：1–80 字符；`command`：1–4000 字符；首尾空白会被去掉；最多 50 项；其它字段忽略。
  - `command` 不得包含控制字符或不可见字符：Unicode `Cc`（C0、DEL、C1，含换行与回车）、`Cf`（含双向控制符
    U+202A–U+202E、U+2066–U+2069 与零宽字符）、`Zl`/`Zp` 行/段分隔符、`Default_Ignorable_Code_Point`（如韩文填充符）、
    盲文空白 U+2800，也不得有超过 16 个的连续空白。这样菜单展示的就是一次输入将执行的全部内容：不能在换行后藏第二条
    命令，不能用双向控制符让显示顺序与执行顺序不同，也不能用大段空白把后续命令挤出可视区域。
  - `name` 只用于显示：拒绝 `Cc`、`Zl`/`Zp` 与会重排显示顺序的双向嵌入/覆盖/隔离符（U+202A–U+202E、U+2066–U+2069），
    保留 ZWJ 表情与 LRM/RLM 等正常排版字符。
- 解析由 `@zcode/shared` 的 `parseProjectActionsConfig` 完成（zod 校验）：文件缺失或没有 `actions` → 空列表；
  JSON 无效或 `actions` 不合规 → 空列表并报告错误（菜单提示，不执行任何命令）。
- CLI 读取同一文件时顶层 schema 为 passthrough，新增 `actions` 与 `worktree` 不影响 CLI 配置加载。
- 同一文件的 `worktree.setup` 是新建 worktree 后的 setup 命令，见 [git-worktree-task.md](git-worktree-task.md)。
- UI 每次打开菜单时直接 `readTextFile` 读取一次（最多 256 KB；超出时提示文件过大，而不是截断后报 JSON 无效），不缓存、不监听；文件即唯一事实来源。读取报文件不存在
  视为没有操作；不使用 `checkFilesExist`（它为聊天路径提及缓存一分钟正负结果，会读到过期结论）。远程工作区经
  `useWorkspaceServices` 的 `fileService` 读取。

## 运行

- 标题栏终端按钮左侧新增“运行操作”菜单（办公模式与手机远控窄头部不显示，与终端按钮一致）。每项显示名称与**完整**命令（自动换行，不截断；菜单整体可滚动）。
- 点击一项：在右侧面板新建终端标签（标题为操作名，cwd 为工作区根），并把命令作为该终端的首条输入执行。
  - 首条输入由内存中的一次性登记表 `pendingTerminalCommands`（按终端标签 id）保存，终端会话在 PTY 创建完成、
    输出与退出订阅都登记之后**立即**取出并写入 `command + "\r"`（先订阅退出：`exit` 这类立即结束 shell 的命令
    的退出事件不会丢失）（与 VS Code `sendText` 一致，由 TTY 缓冲到 shell 读取），取出即删除。
    不等待第一段输出：宿主不缓冲订阅前的输出，远程延迟下提示符可能早于订阅发出，等待会把命令拼到用户首次按键之后；
    Windows ConPTY 的首段输出也不是提示符。标签状态中不保存命令，
    因此刷新或恢复标签不会重复执行。
  - 不自动执行任何命令：只有用户点击菜单项才运行，且命令在菜单与终端中完整可见，可随时中断。
- 只读工作区中菜单禁用（与终端按钮使用同一 `readOnlyReason`）。

## 验收

- `packages/ui/test/projectActions.test.ts`：配置解析（缺失、有效、无效 JSON、字段越界、多余字段）与一次性登记表语义。
- Web 开发服务 + Playwright：在演示工作区写入两个操作，打开菜单看到名称与命令；点击后新建终端标签并执行命令
  （终端输出出现命令结果）；无配置时菜单显示空态提示。
