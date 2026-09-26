# Start a task in a new Git worktree

> Chinese version: [git-worktree-task.md](git-worktree-task.md). The Chinese file is normative; keep both in sync.

## Background

Codex desktop can run a task in its own worktree, so it doesn't disturb the current checkout. ZCode
only has "create branch and switch", which switches the current checkout, and no way to create a
worktree; the agent can only call `git worktree` itself through bash. This spec reuses the existing
branch dialog, workspace opening and draft transfer, and adds one Git service method.

## Interface and state owners

- Git itself is the source of truth for worktrees; ZCode keeps no separate worktree list.
- `IGitService.createWorktree({ workspacePath, branchName }): Promise<GitCreateWorktreeResult>`,
  implemented by `createGitService` → `GitCliRepo.createWorktree` (code in
  `git/repo/gitWorktree.ts`):
  - Success: `{ ok: true, branchName, worktreePath, workspacePath }`. Failure:
    `{ ok: false, branchName, issues }`, where `issues` reuses `GitBranchMutationIssue` (invalid branch
    name, branch already exists, unknown).
- The new workspace is just a new path: its identity key stays
  `workspaceIdentity?.trim() || workspacePath`, with no new protocol field.

## Service rules

1. An unavailable repository is an error. An invalid or existing branch name returns the matching
   issue and creates no worktree. The worktree starts from HEAD and does not touch the current
   checkout, so conflicts or a merge/rebase in progress there do not block it.
2. Worktree root: `<ZCode data dir>/worktrees/<repo folder name>-<first 8 hex of sha256(repo root)>/<branch slug>`.
   The slug replaces characters outside `[A-Za-z0-9._-]` with `-`. If the directory exists, try `-2`,
   `-3`, … (up to 99). It lives outside the repository so it never shows up in the original repo's
   file tree or `git status`.
3. Run `git worktree prune` first (it only drops entries whose directory was deleted; otherwise a
   manually deleted directory of the same name makes the add fail), then
   `git worktree add -b <branch> <path> HEAD`: the new branch starts at the current HEAD.
   **Uncommitted changes are not carried into the new worktree.**
4. If the original workspace is a subdirectory of the repository, the returned `workspacePath` is the
   same subdirectory inside the new worktree. If that subdirectory doesn't exist at HEAD (untracked,
   ignored or new), it falls back to the worktree root.
5. On failure, parse git's output into issues; on success, invalidate the original workspace's cache.

## Interaction

- Only a local workspace's draft composer branch switcher shows "Start in new worktree…" at the
  bottom. Remote workspaces need remote identity construction and are not covered yet.
- It reuses the "create branch" dialog (`mode="worktree"` switches the text), which explains that the
  worktree starts from the current commit without uncommitted changes.
- On success, `requestV4ComposerDraftWorkspaceTransfer` moves the current draft to the new path, then
  `handleStartDraftInWorkspace(newPath, undefined, "project")` opens it as a draft. On failure the
  dialog stays open and a toast shows the first issue. The dialog can't be closed while creation is
  running, and a result that arrives after the host component unmounted is ignored, so it never moves
  the draft or switches workspace late.
- Strings live under `git.worktree.*`, in both `en-US` and `zh-CN`.

## Deleting a worktree

- Only worktrees **created by ZCode** can be deleted: the workspace's checkout is a linked worktree (not
  the main checkout) and its root is under `<ZCode data dir>/worktrees/`. Repositories or worktrees the
  user created themselves get no delete entry.
- `IGitService.getManagedWorktree({ workspacePath })` returns `{ worktreePath, mainWorktreePath,
branchName }` when those conditions hold, otherwise `null` (the main checkout and branch come from
  `git worktree list --porcelain`).
- `IGitService.removeWorktree({ workspacePath, force? })`:
  - Conditions not met → `{ ok: false, reason: "not-managed" }`.
  - Without `force`, a worktree with uncommitted changes (including untracked files) →
    `{ ok: false, reason: "dirty" }`, and nothing is deleted.
  - Runs `git worktree remove [--force] <worktreePath>` in the main checkout; failure →
    `{ ok: false, reason: "failed", detail }`.
  - Success → `{ ok: true, mainWorktreePath, branchName }`. **The branch and its commits are kept**;
    only the folder and the worktree registration are removed.
- Interaction: for a local workspace, the sidebar menu shows "Delete worktree" when
  `getManagedWorktree` returns a value (queried when the menu opens).
  1. If the workspace has a running conversation, the existing "Remove" confirmation for running
     workspaces comes first.
  2. A destructive confirmation names the folder that will be deleted and the branch that is kept.
  3. It calls `removeWorktree`. On `dirty`, a second confirmation says uncommitted changes will be lost
     for good, and confirming retries with `force`.
  4. On success it does the same cleanup as "Remove" (close the tab, release the runtime, invalidate
     the task cache) and says the branch was kept. Failures show a toast.
- Strings: `workspaceSidebar.deleteWorktree` and `git.worktree.delete.*`, in both `en-US` and `zh-CN`.

## Setup command after creation

- Configuration: `worktree.setup` (a string) in the source workspace's root `.zcode/config.json`. Same
  rules as a project action's `command`: 1–4000 characters after trimming, no control characters (C0
  and DEL, including newlines). Parsed by `parseWorktreeSetupConfig` in `@zcode/shared`; independent
  of `actions`, so one being invalid doesn't affect the other.

  ```json
  { "worktree": { "setup": "pnpm install" } }
  ```

- Reading: the source workspace's config is read once each time the dialog opens, with the same
  reader as the project actions menu (`readTextFile` directly, up to 256 KB, a missing file means not
  configured, no cache). It reads the source workspace's current file, so the dialog shows exactly
  the command that will run, even if the new worktree's HEAD has a different version.
- Dialog: when configured, it shows a "Run setup command after creating" checkbox (checked by
  default) and the **full** command (monospace, wrapped, never truncated). An invalid, too large or
  unreadable config shows a hint and offers no run; without a setup command nothing is shown. The
  checkbox is disabled while creation runs.
- Running: when creation succeeds and the box is checked, **before** the draft transfer and the
  workspace switch, `{ name: localized "Setup", command }` is registered in the in-memory one-shot
  table `pendingWorkspaceSetup`, keyed by the new workspace's identity key (for a local worktree, its
  path). After the current workspace identity key changes, `useAppPanels` takes it (taking deletes
  it) and passes it to the project actions handler `handleRunProjectAction`: a new terminal tab in
  the new workspace's side pane (cwd is the new workspace path) runs the command as its first input.
  The command never enters tab state, so a reload or restore doesn't run it again.
- The setup command's outcome doesn't affect the worktree or the draft: its output stays in the
  terminal, where the user can interrupt, re-run or close it.

```mermaid
sequenceDiagram
  participant D as Worktree dialog
  participant G as IGitService
  participant P as pendingWorkspaceSetup
  participant L as WorkspaceShellLayout
  participant A as useAppPanels
  participant T as TerminalSession
  D->>G: createWorktree
  G-->>D: ok (new workspacePath)
  D->>P: set(new key, command) (only when checked)
  D->>L: onCreated
  L->>L: transfer draft → handleStartDraftInWorkspace
  A->>P: take(current key) (effect after the key changes)
  A->>T: new terminal tab + pendingTerminalCommands
  T->>T: writes command + "\r" after the PTY is created
```

## Out of scope for now

- Handing changes off between a worktree and the local checkout, and remote workspaces.

## Acceptance

- `packages/services/test/gitWorktree.test.ts` (real temporary repository): deletion only works for
  ZCode-created worktrees, uncommitted changes need `force`, and after deletion the folder is gone while
  the branch is kept; creation succeeds and
  checks out the new branch; subdirectory workspace mapping; a suffix when the directory exists; an
  existing branch and an invalid branch name return issues without creating a directory; uncommitted
  changes are not carried over.
- `packages/ui/test/projectActions.test.ts`: `worktree.setup` parsing (missing, valid, not a string,
  control characters, independent of `actions`) and the one-shot semantics of `pendingWorkspaceSetup`.
- Web dev server + Playwright: choose "Start in new worktree…" in the draft branch menu, enter a
  branch name, and the new workspace opens with the draft text carried over; `git worktree list`
  shows the new entry. With `worktree.setup` configured, the dialog shows the full command; creating
  with the box checked opens a Setup terminal in the new workspace's side pane that runs it, and
  unchecking it runs nothing.
