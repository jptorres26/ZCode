# Review pane file-level Git actions (stage / unstage / discard)

> English translation of [git-review-pane-file-actions.md](git-review-pane-file-actions.md). The Chinese file is the normative source; keep both in sync.

## Background and goal

The Review pane (`packages/ui/src/GitPane.tsx`) could only display changes. `IGitService`
already provides `stagePaths` / `unstagePaths` / `discardPaths`, but the UI was wired only to
a placeholder toast (`useGitActions`). This spec lets users stage, unstage, and discard per file
or in bulk from the Review pane, matching the Codex desktop review pane, and fixes the service's
behavior for renames, untracked files, conflicted files, and repositories without commits.

## State owner and single path

- The only owner of repository state is the real index / worktree. The UI keeps no optimistic
  "staged" copy.
- One write path: `GitPane` → `useServices().gitService.{stagePaths,unstagePaths,discardPaths}`
  → `createGitService` → `GitCliRepo.{stage,unstage,discard}`. No new RPC, no new IPC.
- The read path is unchanged: when a mutation settles (success or failure) the pane calls the
  existing `onRefresh`, and `useGitRepository` re-fetches one `gitService.refresh` snapshot via
  its `refreshToken`.
- Remote workspaces reuse the `gitService` from the pane's `ServiceProvider`, the same path as
  commit/push in `GitActionMenu`; when `useGitRepository` decides workspace RPC is unavailable,
  the pane renders no actions.

```text
user click ──> GitPane (single in-flight lock) ──> [discard: confirm dialog] ──> gitService.xxxPaths
                                                                                   │
                      toast (failure) <── catch ─────────────────────────────────────┤
                                                                                   ▼
                                      finally: release lock → onRefresh() → useGitRepository re-fetch
```

Ordering constraints: at most one mutation per pane at a time; the refresh fires only after the
request settles; the refresh result is identified by `gitState.revision`, and the old diff cache
is cleared with the revision (existing logic).

## Action matrix

| Source      | Section      | Row actions                                | Bulk actions (pane header)             |
| ----------- | ------------ | ------------------------------------------ | -------------------------------------- |
| `unstaged`  | `unstaged`   | Stage, Discard (restore worktree)          | Stage all, Discard all                 |
| `unstaged`  | `untracked`  | Stage, Discard (delete the untracked file) | Same                                   |
| `unstaged`  | `conflicted` | Stage (mark resolved); no Discard          | Stage all; Discard all skips conflicts |
| `staged`    | `staged`     | Unstage, Discard (restore to HEAD)         | Unstage all, Discard all               |
| `branch`    | `branch`     | None (read-only comparison)                | None                                   |
| `last-turn` | `last-turn`  | None (read-only)                           | None                                   |

No actions render while the repository is loading, on error, when Git is unavailable, or when the
workspace is not a repository. No actions render for datasets with `readonly === true`.

## Service semantics (`GitCliRepo`)

- `stage(paths)`: `git add -- <paths>` (unchanged).
- Path classification: first runs `git status --porcelain=v2 -z --untracked-files=normal -- <paths>`
  (a fully untracked large directory is reported as a single `dir/`, so the output stays under the
  limit). A path-scoped status cannot detect renames, so when rename origins are needed the
  unscoped `git diff --cached --name-status -z -M --diff-filter=R` is read as well. Paths absent
  from the status (already clean, ignored, or deleted) have nothing to act on and are skipped, so
  repeated requests stay idempotent.
- `unstage(paths)`:
  - For a staged rename the original path is passed to `git restore --staged` as well, otherwise
    the deletion of the original path stays staged.
  - When the repository has no commit yet (no HEAD) it uses `git rm --cached -r -q -- <paths>`,
    keeping the worktree files.
- `discard(paths, staged)`:
  - Conflicted paths fail with `Cannot discard paths with unresolved conflicts.` and nothing is
    partially applied.
  - Untracked paths are removed with `git clean -f -q -- <paths>`; `-x` is never used, so ignored
    files are untouched.
  - Tracked paths: `staged=false` uses `git restore --worktree`; `staged=true` uses
    `git restore --source=HEAD --staged --worktree`, restoring the original path of a rename too.
  - With no commit yet and `staged=true`, it uses `git rm -f -r -q -- <paths>` (the new file is
    removed from the index and worktree).
- Every branch calls the existing `invalidate(workspacePath)` afterwards.

## Interaction and visuals

- Each file row shows icon buttons on the right (`Button size="icon-sm" variant="ghost"` with
  `aria-label` and `ControlHintTooltip`): on pointer devices they appear on row hover / keyboard
  focus; on touch (`hover: none`) they are always visible, so mobile Web does not hide core actions.
- The row context menu offers the same actions, driven by the same availability check.
- The pane header offers bulk actions to the left of Refresh (`size="lg" variant="ghost"`).
- Every discard (single or bulk) first opens a confirmation (`confirmVariant="destructive"`) that
  states the file count, that it cannot be undone, and, when untracked files are included, that
  they will be deleted.
- While a request is in flight all action buttons are disabled; on failure a toast shows the
  service error message and `logger.warn` records it (no file contents are logged).
- Copy uses `git.fileAction.*` i18n keys, provided in both `en-US` and `zh-CN`.

## Acceptance scenarios

1. Clicking Stage on a file in the `unstaged` source moves it to the `staged` source after refresh.
2. Unstaging a staged rename in the `staged` source no longer leaves the original path as a
   staged deletion.
3. Discarding an untracked file and confirming deletes it; cancelling the confirmation writes nothing.
4. Discarding a staged rename and confirming restores the original file and removes the new path.
5. Conflicted files show no Discard; the service rejects a discard request for a conflicted path
   and modifies nothing.
6. Unstaging in a repository without commits keeps the worktree file.
7. The `branch` / `last-turn` sources show no actions.

Automated coverage: `packages/services/test/gitPathMutations.test.ts` (real temporary
repositories for 2–6) and `packages/ui/test/gitPaneFileActions.test.ts` (action matrix and bulk
path selection). The UI interaction of scenarios 1/3 is verified manually through the Web dev
server + Playwright, with results recorded in the PR description.
