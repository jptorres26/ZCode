# Create a pull (merge) request link after pushing

> English translation of [git-pull-request-link.md](git-pull-request-link.md). The Chinese file is the normative source; keep both in sync.

## Background

Codex desktop can open a PR right after pushing. ZCode only had commit and push, with no PR entry
point. This spec offers "Create pull request" after a successful push, opening the hosting
platform's new-PR page in the browser with the branches prefilled. No hosting API is called, no
token is needed, and no credentials are stored on the client.

## State owner and interfaces

- The owner of remote information is the repository configuration. A new read-only method
  `IGitService.getPullRequestLink({ workspacePath }): Promise<GitPullRequestLink | null>` is
  implemented by `createGitService` → `GitCliRepo.getPullRequestLink`; remote workspaces forward it
  through the existing generic proxy.
- `GitPullRequestLink`: `{ provider: "github" | "gitlab" | "bitbucket"; url; headBranch; baseBranch | null }`.
- URL construction is the pure function `buildGitPullRequestLink` in `@zcode/shared`, for unit testing.

## Resolution rules

1. Only computed when HEAD is on a branch (not detached).
2. Push destination (the same one a bare `git push` uses): the remote is `branch.<name>.pushRemote`,
   then `remote.pushDefault`, then `branch.<name>.remote`; with none, or `.`, the result is `null`.
   When it is the upstream's remote, the source branch is `branch.<name>.merge` with `refs/heads/`
   stripped (`null` if it isn't a branch ref). When it is another remote (such as a fork), the source
   branch is the local branch name, since `push.default` simple/current/matching push the same name
   there. The link points at the repository that was pushed to, and the host's page picks the target
   repository.
3. Remote address: `git remote get-url <remote>` (with `insteadOf` applied). Supports `https://`,
   `http://`, `ssh://`, `git://`, and the scp form `user@host:owner/repo.git`. The web address
   always drops user names, passwords, and tokens; ssh / git / scp forms become `https://host/...`
   and drop the ssh port. In those forms the host may be an ssh alias: aliases like `github.com-work`
   (a known platform host plus a suffix) map back to the canonical host, and bare aliases without a
   dot cannot be mapped to a web host, so the result is `null`; http(s) keeps the original port and scheme. The path must have at least
   two segments with no empty segment or `..`, and a trailing `.git` and `/` are removed. Host
   names only accept `[A-Za-z0-9.-]`.
4. Platform: a host of `github.com` or containing `github` → GitHub; `gitlab.com` or containing
   `gitlab` → GitLab; `bitbucket.org` → Bitbucket; anything else returns `null` (URL formats of
   unknown platforms are not guessed).
5. Target branch: `git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` with the remote
   prefix removed; when unavailable it is `null` and the platform uses its default branch. When
   the source and target branch are the same the result is `null`.
6. URL:
   - GitHub: `/<path>/compare/<base>...<head>?expand=1` (without a base, `/compare/<head>?expand=1`);
   - GitLab: `/<path>/-/merge_requests/new?merge_request[source_branch]=<head>[&merge_request[target_branch]=<base>]`;
   - Bitbucket: `/<path>/pull-requests/new?source=<head>[&dest=<base>]`.
7. Branch names are encoded as URL components; `/` is kept in GitHub paths.

## Interaction

- After a successful push (push dialog or "Commit and push") the UI looks up the link once; when
  one exists, the success toast carries a "Create pull request" action ("Create merge request" for
  GitLab) with a longer display time, opened through `IPlatformService.openExternal`.
- A failed lookup is only logged and does not affect the push result toast.
- Copy uses `git.actionMenu.pullRequest.*`, provided in both `en-US` and `zh-CN`.

## Acceptance

- `packages/ui/test/gitPullRequestLink.test.ts`: remote address forms, credential stripping,
  unknown platforms, same-name branches, encoding.
- `packages/services/test/gitPullRequestLink.test.ts`: upstream, default branch, and no-upstream
  cases in real temporary repositories.
- Web dev server + Playwright: pushing to a local bare repository (`pushurl`) while the fetch URL
  is GitHub shows the toast action, which opens the correct URL.
