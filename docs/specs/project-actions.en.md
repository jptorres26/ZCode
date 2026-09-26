# Project actions

> Chinese version: [project-actions.md](project-actions.md). The Chinese file is normative; keep both in sync.

## Background

Codex desktop's local environments can define "actions": one click runs a project command (tests,
a dev server) in the built-in terminal. ZCode already has built-in terminal tabs and the workspace
config file `<workspace>/.zcode/config.json`, but no way to declare and run project commands. This
spec reuses both and adds no service or protocol.

## Configuration (single owner)

A top-level `actions` array in `<workspace>/.zcode/config.json`:

```json
{
  "actions": [
    { "name": "Test", "command": "pnpm test" },
    { "name": "Dev server", "command": "pnpm dev" }
  ]
}
```

- Only the workspace root's `.zcode/config.json` is read; there is no walk up to parent folders, so
  the result is deterministic.
- `name`: 1–80 characters; `command`: 1–4000 characters. Neither may contain control characters (C0
  and DEL, including newlines and carriage returns; leading and trailing whitespace is trimmed). At
  most 50 actions; other fields are ignored. Rejecting control characters means the menu shows
  everything a single input will run: a second command can't hide after a newline.
- `parseProjectActionsConfig` in `@zcode/shared` parses it with zod. A missing file or no `actions`
  gives an empty list. Invalid JSON or an invalid `actions` value gives an empty list plus an error,
  which the menu shows; no command runs.
- The CLI reads the same file with a passthrough top-level schema, so the new `actions` and `worktree` keys do not
  affect CLI config loading.
- `worktree.setup` in the same file is the setup command for new worktrees; see
  [git-worktree-task.en.md](git-worktree-task.en.md).
- The UI reads the file with `readTextFile` (up to 256 KB; a larger file shows a "too large" hint
  rather than being cut off and reported as invalid JSON) once each time the menu opens, with no cache and no
  watcher; the file is the single source of truth. A not-found error means no actions.
  `checkFilesExist` is not used: it caches positive and negative results for a minute for chat path
  mentions, so it can return a stale answer. Remote workspaces read the file through the
  `fileService` from `useWorkspaceServices`.

## Running

- A "Run action" menu sits to the left of the terminal button in the header. Like the terminal
  button, it is hidden in office mode and in the narrow mobile remote-control header. Each item shows
  the name and the **full** command (wrapped, never truncated; the menu scrolls).
- Clicking an item opens a new terminal tab in the side pane (titled with the action name, cwd at
  the workspace root) and runs the command as that terminal's first input.
  - The first input is held in an in-memory, take-once registry, `pendingTerminalCommands`, keyed by
    the terminal tab id. As soon as the terminal session has created its PTY, it takes the command and
    writes `command + "\r"` **immediately** (like VS Code's `sendText`; the TTY buffers it until the
    shell reads it); taking it removes it. It does not wait for the first output: the host doesn't
    buffer output emitted before the subscription, so with remote latency the prompt can go out
    before the subscription exists, and waiting would glue the command onto the user's first
    keystroke. On Windows, ConPTY's first output isn't the prompt either. The command is never stored in tab state, so a reload or restored tab never runs it
    again.
  - Nothing runs automatically: a command runs only when the user clicks its menu item, and the
    command is fully visible in the menu and in the terminal, where it can be interrupted.
- In a read-only workspace the menu is disabled, using the same `readOnlyReason` as the terminal
  button.

## Acceptance

- `packages/ui/test/projectActions.test.ts`: config parsing (missing, valid, invalid JSON, out-of-range
  fields, extra fields) and the take-once registry semantics.
- Web dev server + Playwright: with two actions written into the demo workspace, the menu shows their
  names and commands; clicking one opens a terminal tab that runs the command (its output appears in
  the terminal); without a config the menu shows the empty-state hint.
