# 在外部应用中打开：Linux 编辑器、终端与文件管理器；macOS Xcode

> 英文版：[open-in-editor-linux.en.md](open-in-editor-linux.en.md)。本文件为规范来源，两者保持同步。

## 背景

工作区头部与文件卡片的“在…中打开”（`WorkspaceEditorButtonGroup`、`OpenSplitButton`）依赖
Main 进程 `getInstalledEditors()` / `openInEditor()`。此前 `getEditorDefsForCurrentPlatform()`
在 Linux 返回空数组，Linux 桌面用户看不到任何入口。Codex desktop 提供 VS Code、Cursor、
终端、文件管理器与 Xcode 等目标，本规范补齐 Linux 并在 macOS 增加 Xcode。

## 状态所有者与接口

- 检测与打开均由 Main 进程拥有；UI 只消费既有 `EditorInfo[]` 与 `openInEditor(editorId, path, options)`，
  协议与 IPC 不变。
- Linux 检测：`packages/desktop/src/main/linuxEditors.ts`，异步查找可执行文件，结果在进程生命周期内缓存
  （与 macOS / Windows 一致）。

## Linux 检测规则

- 查找目录：`PATH` 各项，外加 `~/.local/share/JetBrains/Toolbox/scripts` 与 `/snap/bin`；
  只接受存在且可执行的普通文件。每个目标按候选命令顺序取第一个命中。
- 目标（id → 候选命令）：
  - 编辑器：`vscode` → `code`；`vscode-insiders` → `code-insiders`；`vscodium` → `codium`；
    `cursor` → `cursor`；`zed` → `zed`、`zeditor`；`sublime` → `subl`；JetBrains `idea`、`webstorm`、
    `pycharm`、`goland`、`clion`、`rider`、`phpstorm`、`rubymine`、`datagrip`（含 snap 名称如
    `intellij-idea-community`、`pycharm-community`）。
  - 终端：`terminal` → `x-terminal-emulator`、`gnome-terminal`、`konsole`、`xfce4-terminal`、
    `kitty`、`alacritty`、`wezterm`、`ghostty`（只展示一个“终端”）。
  - 文件管理器：`file-manager` → `xdg-open`（显示名“文件管理器 / Files”）。
- 图标：在 XDG `applications` 目录中找 `Exec` 首个参数与命令同名的 `.desktop` 条目，读取 `Icon`；
  绝对路径直接使用，主题名在 `hicolor` 各尺寸与 `pixmaps` 中查找 `png` / `svg`。找不到时使用内置的
  中性 SVG 图标（编辑器 / 终端 / 文件夹），保证入口不因缺图标被丢弃。

## 打开行为

- 编辑器：以参数数组 `spawn(command, [path])` 启动，`detached` + `stdio: "ignore"` 并 `unref()`，
  在 `spawn` 事件时视为成功，`error` 事件（如 ENOENT）返回失败；不等待 GUI 进程退出。
- 终端：目录为 `path`（文件取其所在目录），`cwd` 设为该目录，并按终端传入已知的工作目录参数
  （gnome-terminal / xfce4-terminal / ghostty `--working-directory=`，konsole `--workdir`，
  kitty `--directory`，alacritty `--working-directory`，wezterm `start --cwd`）。
- 文件管理器：文件用 `shell.showItemInFolder`，目录用 `shell.openPath`。
- 远程 SSH / WSL 的 VS Code 分支保持不变（`code --folder-uri`）。

## macOS Xcode

`/Applications/Xcode.app` 存在时展示 “Xcode”，经既有 `open -a` 路径打开。

## 验收

`packages/desktop/test/linuxEditors.test.ts` 覆盖：PATH 解析与候选顺序、不可执行文件被忽略、
`.desktop` 解析与图标主题查找、终端参数、无图标时的回退。Electron 真实启动在当前沙箱不可用
（node-pty 重建被拒），PR 中如实记录。
