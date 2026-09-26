# Open in external apps: Linux editors, terminals and file managers; macOS Xcode

> English translation of [open-in-editor-linux.md](open-in-editor-linux.md). The Chinese file is the normative source; keep both in sync.

## Background

The "Open in…" entries in the workspace header and on file cards (`WorkspaceEditorButtonGroup`,
`OpenSplitButton`) rely on the main process's `getInstalledEditors()` / `openInEditor()`.
`getEditorDefsForCurrentPlatform()` returned an empty array on Linux, so Linux desktop users saw no
entry at all. Codex desktop offers VS Code, Cursor, terminals, file managers, Xcode and more; this
spec fills in Linux and adds Xcode on macOS.

## State owner and interfaces

- Detection and opening are owned by the main process; the UI only consumes the existing
  `EditorInfo[]` and `openInEditor(editorId, path, options)`. Protocol and IPC are unchanged.
- Linux detection lives in `packages/desktop/src/main/linuxEditors.ts`. It looks up executables
  asynchronously, and results are cached for the process lifetime (as on macOS / Windows).

## Linux detection rules

- Search directories: every `PATH` entry, plus `~/.local/share/JetBrains/Toolbox/scripts` and
  `/snap/bin`. Only existing, executable regular files count. Each target takes the first hit in
  candidate-command order.
- Targets (id → candidate commands):
  - Editors: `vscode` → `code`; `vscode-insiders` → `code-insiders`; `vscodium` → `codium`;
    `cursor` → `cursor`; `zed` → `zed`, `zeditor`; `sublime` → `subl`; JetBrains `idea`, `webstorm`,
    `pycharm`, `goland`, `clion`, `rider`, `phpstorm`, `rubymine`, `datagrip` (including snap names
    such as `intellij-idea-community` and `pycharm-community`).
  - Terminal: `terminal` → `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`,
    `kitty`, `alacritty`, `wezterm`, `ghostty` (only one "Terminal" is shown).
  - File manager: `file-manager` → `xdg-open` (shown as "Files").
- Icons: find the `.desktop` entry in the XDG `applications` directories whose `Exec` program
  matches the command and read its `Icon`. An absolute path is used directly; a theme name is looked
  up as `png` / `svg` in each `hicolor` size and in `pixmaps`. When nothing is found a built-in
  neutral SVG (editor / terminal / folder) is used, so no entry is dropped for lack of an icon.

## Opening behavior

- Editors: launched with an argument array, `spawn(command, [path])`, `detached` +
  `stdio: "ignore"` and `unref()`. The `spawn` event counts as success and an `error` event (such as
  ENOENT) is reported as failure; the GUI process is not awaited.
- Terminals: the directory is `path` (a file's parent directory for files). `cwd` is set to it,
  and each terminal's known working-directory flag is passed as well (gnome-terminal /
  xfce4-terminal / ghostty `--working-directory=`, konsole `--workdir`, kitty `--directory`,
  alacritty `--working-directory`, wezterm `start --cwd`).
- File manager: files use `shell.showItemInFolder`; directories use `shell.openPath`.
- The remote SSH / WSL VS Code branches are unchanged (`code --folder-uri`).

## macOS Xcode

When `/Applications/Xcode.app` exists, "Xcode" is shown and opened through the existing `open -a` path.

## Acceptance

`packages/desktop/test/linuxEditors.test.ts` covers PATH resolution and candidate order, ignoring
non-executable files, `.desktop` parsing and icon-theme lookup, terminal arguments, and the
fallback when no icon is found. Launching real Electron is not possible in the current sandbox
(the node-pty rebuild is refused); the PR records this.
