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
- Input paths resolve only the parent folder's real path (so symlinks in the workspace path still
  work) and keep the last component literal: when a change is itself a symlink, stage and discard act
  on the link, never on its target (otherwise discarding an untracked link to a folder would clean the
  target folder).
- `unstage(paths)`:
  - For a staged rename the original path is passed to `git restore --staged` as well, otherwise
    the deletion of the original path stays staged.
  - When the repository has no commit yet (no HEAD) it uses `git rm --cached -f -r -q -- <paths>`,
    keeping the worktree files (`--cached` touches only the index; `-f` skips the "staged content
    differs from both the file and the HEAD" check, without which a new file changed again after
    staging can't be unstaged).
- `discard(paths, staged)`:
  - Conflicted paths fail with `Cannot discard paths with unresolved conflicts.` and nothing is
    partially applied.
  - Untracked paths are removed with `git clean -f -q -- <paths>`; `-x` is never used, so ignored
    files are untouched. Only one `-f` is passed, so a nested Git repository is not deleted (it may hold
    unpushed commits, and the confirmation doesn't say a repository will go), yet git still exits 0.
    So afterwards the status of those paths is read again, and if untracked content remains it fails
    and lists those paths, which the UI shows as a failure.
  - Tracked paths: `staged=false` uses `git restore --worktree`; `staged=true` uses
    `git restore --source=HEAD --staged --worktree`, restoring the original path of a rename too.
  - A staged deletion (`D.`) with something re-created at the same path in the working tree (a file,
    folder or link, including one `.gitignore` ignores, such as a tracked `.env`): `staged=true`
    refuses the whole discard and lists those paths (it checks whether the path exists in the working
    tree rather than relying on status), because restoring the HEAD version would silently overwrite
    what was re-created, so the user moves or deletes it first. `staged=false`
    skips paths that only match the staged deletion (the index has no such path, and there is nothing
    to restore on the working-tree side), deletes only the re-created untracked content, and keeps the
    staged deletion.
  - With no commit yet and `staged=true`, it uses `git rm -f -r -q -- <paths>` (the new file is
    removed from the index and worktree).
- Every branch calls the existing `invalidate(workspacePath)` afterwards.

## Interaction and visuals

- Each file row shows icon buttons on the right (`Button size="icon-sm" variant="ghost"` with
  `aria-label` and `ControlHintTooltip`): on pointer devices they appear on row hover / keyboard
  focus; on touch (`hover: none`) they are always visible, so mobile Web does not hide core actions.
- The row context menu offers the same actions, driven by the same availability check.
- The first context menu item is "Open file". It calls the side pane's existing
  `onOpenCodeViewer` with `{ type: "file", title: <file name>, path: <absolute path> }`, opening
  the working-tree version in the in-app file viewer. It is disabled for deleted files, files no longer
  in the working tree (such as `MD`, modified in the index and deleted from the working tree, whose kind
  follows the index as modified, or a branch-comparison file deleted locally; the service sets
  `isMissingInWorkingTree`), collapsed untracked folders (`dir/`) and submodules (a folder in the working tree; the service sets
  `isSubmodule` when the working-tree mode `<mW>` of porcelain v2 status is 160000 and, for the branch
  comparison, when the new side in `diff --raw` is; a submodule replaced by a regular file can be
  previewed), none of which has a file to preview, and hidden
  when the host passes no `onOpenCodeViewer`. It is read-only, so every source offers it.
- The pane header offers bulk actions to the left of Refresh (`size="lg" variant="ghost"`).
  When the source picker and the action group don't fit on one line, the whole group wraps to
  the next line, right-aligned, and never overlaps the source picker (the mobile web side pane is
  about 200px wide).
- Every discard (single or bulk) first opens a confirmation (`confirmVariant="destructive"`) that
  states the file count and that it cannot be undone; when files will be deleted from disk
  (untracked files, or files newly added in the `staged` source) it also states how many. After
  status output overflows and switches to collapsed mode, a whole untracked folder shows as a single
  `dir/` entry while discarding deletes everything inside it: such entries are counted as folders
  and the text says "N untracked folder(s), with everything inside them", never as one file.
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
7. The `branch` / `last-turn` sources show no Stage / Unstage / Discard actions.
8. Choosing "Open file" from a row's context menu adds a preview tab for that file to the side
   pane; for a deleted file the item is disabled.

Automated coverage: `packages/services/test/gitPathMutations.test.ts` (real temporary
repositories for 2–6) and `packages/ui/test/gitPaneFileActions.test.ts` (action matrix and bulk
path selection). The UI interaction of scenarios 1/3 is verified manually through the Web dev
server + Playwright, with results recorded in the PR description.
