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
3. Run `git worktree add -b <branch> <path> HEAD`: the new branch starts at the current HEAD.
   **Uncommitted changes are not carried into the new worktree.**
4. If the original workspace is a subdirectory of the repository, the returned `workspacePath` is the
   same subdirectory inside the new worktree.
5. On failure, parse git's output into issues; on success, invalidate the original workspace's cache.

## Interaction

- Only a local workspace's draft composer branch switcher shows "Start in new worktree…" at the
  bottom. Remote workspaces need remote identity construction and are not covered yet.
- It reuses the "create branch" dialog (`mode="worktree"` switches the text), which explains that the
  worktree starts from the current commit without uncommitted changes.
- On success, `requestV4ComposerDraftWorkspaceTransfer` moves the current draft to the new path, then
  `handleStartDraftInWorkspace(newPath, undefined, "project")` opens it as a draft. On failure the
  dialog stays open and a toast shows the first issue.
- Strings live under `git.worktree.*`, in both `en-US` and `zh-CN`.

## Out of scope for now

- Removing or cleaning up worktrees, handing changes off between a worktree and the local checkout,
  and running a setup script after creation (which could plug into project actions).

## Acceptance

- `packages/services/test/gitWorktree.test.ts` (real temporary repository): creation succeeds and
  checks out the new branch; subdirectory workspace mapping; a suffix when the directory exists; an
  existing branch and an invalid branch name return issues without creating a directory; uncommitted
  changes are not carried over.
- Web dev server + Playwright: choose "Start in new worktree…" in the draft branch menu, enter a
  branch name, and the new workspace opens with the draft text carried over; `git worktree list`
  shows the new entry.
