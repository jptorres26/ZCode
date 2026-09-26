# Keyboard shortcut to toggle the Review pane

> Chinese version: [review-pane-shortcut.md](review-pane-shortcut.md). The Chinese file is normative; keep both in sync.

## Background

Codex desktop opens and closes its diff panel with a keyboard shortcut. ZCode only has the generic
"Toggle Side Pane" (`CmdOrCtrl+Alt+B`, which restores the last tab) and the Review button in the
header, with no shortcut that goes straight to Review.

## Rules

- Add `toggleReviewPane` to `SHORTCUT_COMMANDS` (`packages/shared/src/shortcutCommands.ts`, the
  single source of shortcut data): `channel: "window"`, global scope, default
  `CmdOrCtrl+Shift+G` (the same as VS Code's Source Control).
- The handler reuses the header Review button's entry point, `handleToggleGitIfWritable`, through
  `runVisibleWorkspaceCommand`. It adds no state and no new write path. A read-only workspace keeps
  that entry point's read-only check (nothing happens). In office mode (which has no Review) the
  handler is `null`, so the key passes through to the browser.
- The settings page lists the command automatically, labelled with
  `settings.shortcuts.command.toggleReviewPane` in both `en-US` and `zh-CN`. Users can rebind it,
  and the existing conflict check applies.
- No "focus the composer" shortcut is added. Global shortcuts are also captured while the terminal
  has focus, so on Linux and Windows a `Ctrl+letter` binding would swallow a terminal control
  character (`Ctrl+L` clears the screen, `Ctrl+I` is Tab), and `CmdOrCtrl+L` is already reserved.

## Acceptance

- `packages/ui/test/shortcutDefaults.test.ts`: no global default binding conflicts with a reserved
  key or another command, on Apple and non-Apple platforms; `toggleReviewPane` defaults to
  `CmdOrCtrl+Shift+g`.
- Web dev server + Playwright: `Ctrl+Shift+G` opens the Review pane, and pressing it again closes it.
