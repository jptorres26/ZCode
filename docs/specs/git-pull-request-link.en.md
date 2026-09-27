# Create a pull (merge) request link after pushing

> English translation of [git-pull-request-link.md](git-pull-request-link.md). The Chinese file is the normative source; keep both in sync.

## Background

Codex desktop can open a PR right after pushing. ZCode only had commit and push, with no PR entry
point. This spec offers "Create pull request" after a successful push, opening the hosting
platform's new-PR page in the browser with the branches prefilled. No hosting API is called, no
token is needed, and no credentials are stored on the client.

## State owner and interfaces

- The only source of the push destination is the push that just finished. `GitCliRepo.push` runs
  `git push --porcelain`, computes the link from its output after a successful push, and returns it
  with the push result as `GitPushResult.pullRequestLink: GitPullRequestLink | null`; remote workspaces
  forward it through the existing generic proxy. There is no separate lookup method, and the service
  doesn't re-implement git's push rules (`pushRemote`, `pushDefault`, `push.default`,
  `remote.<name>.push` refspecs, `pushurl`, `pushInsteadOf` and so on): the link used to be derived
  from the configuration, and every rule it missed pointed it at a branch that didn't exist or at the
  wrong repository.
- `GitPullRequestLink`: `{ provider: "github" | "gitlab" | "bitbucket"; url; headBranch; baseBranch | null }`.
- URL construction is the pure function `buildGitPullRequestLink` in `@zcode/shared`, for unit testing.

## Resolution rules

1. A push only happens with HEAD on a branch (not detached), so there is always a current branch name.
2. Source branch: the porcelain output has one line per ref, `<flag>\t<from>:<to>\t<summary>`. It takes
   the first line whose `from` is `refs/heads/<current branch>` (or `HEAD` from a push refspec), whose
   `to` starts with `refs/heads/`, and that wasn't rejected (`!`) or a deletion (`-`), and strips
   `refs/heads/`. With no such line (the current branch wasn't pushed, for example because
   `remote.<name>.push` doesn't include it), the result is `null`. The link points at the repository
   that was pushed to, and the host's page picks the target repository.
3. Remote address: the `To <url>` of that line's section, which is the address git actually pushed to
   (with `pushurl` and `insteadOf` / `pushInsteadOf` applied, and user info already removed by git).
   Supports `https://`,
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
5. Target branch: `git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` of the remote pushed to,
   with the remote prefix removed. That remote is the one in `--set-upstream <remote>`, or for a bare
   push the push remote git resolves for the current branch
   (`git for-each-ref --format=%(push:remotename) refs/heads/<branch>`). When unavailable it is `null`
   and the platform uses its default branch. When
   the source and target branch are the same the result is `null`.
6. URL:
   - GitHub: `/<path>/compare/<base>...<head>?expand=1` (without a base, `/compare/<head>?expand=1`);
   - GitLab: `/<path>/-/merge_requests/new?merge_request[source_branch]=<head>[&merge_request[target_branch]=<base>]`;
   - Bitbucket: `/<path>/pull-requests/new?source=<head>[&dest=<base>]`.
7. Branch names are encoded as URL components; `/` is kept in GitHub paths.

## Interaction

- After a successful push (push dialog or "Commit and push") the UI uses the link from the push
  result; when one exists, the success toast carries a "Create pull request" action ("Create merge request" for
  GitLab) with a longer display time, opened through `IPlatformService.openExternal`.
- When computing the link fails, it is `null`, which doesn't affect the push result or its toast.
- Copy uses `git.actionMenu.pullRequest.*`, provided in both `en-US` and `zh-CN`.

## Acceptance

- `packages/ui/test/gitPullRequestLink.test.ts`: remote address forms, credential stripping,
  unknown platforms, same-name branches, encoding.
- `packages/services/test/gitPullRequestLink.test.ts`: parsing the porcelain output, and real
  temporary repositories pushing to local bare repositories through a `core.sshCommand` that routes
  GitHub ssh addresses locally. It covers a first push (`--set-upstream`), a fork (`pushDefault` /
  `pushRemote`), `pushurl`, `push.default`, `remote.<name>.push` (including `HEAD:<branch>`), and a
  current branch that wasn't pushed.
- Web dev server + Playwright: after a push routed to a local bare repository the same way, the toast
  shows the action, which opens the correct URL.
