import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGitPullRequestLink,
  parseGitRemoteWebLocation,
} from "../../shared/src/gitPullRequestLink.js";

test("remote URLs resolve to credential-free web locations", () => {
  const cases: Array<[string, { origin: string; path: string } | null]> = [
    ["https://github.com/example/demo.git", { origin: "https://github.com", path: "example/demo" }],
    [
      "https://user:placeholder-token@github.com/example/demo.git",
      { origin: "https://github.com", path: "example/demo" },
    ],
    ["git@github.com:example/demo.git", { origin: "https://github.com", path: "example/demo" }],
    [
      "ssh://git@gitlab.example.com:2222/group/sub/repo.git",
      { origin: "https://gitlab.example.com", path: "group/sub/repo" },
    ],
    [
      "http://gitlab.internal:8080/team/repo/",
      { origin: "http://gitlab.internal:8080", path: "team/repo" },
    ],
    ["git://github.com/example/demo", { origin: "https://github.com", path: "example/demo" }],
    ["/srv/git/demo.git", null],
    ["file:///srv/git/demo.git", null],
    ["https://github.com/only-owner", null],
    ["https://github.com/a/../b", null],
    ["C:\\repos\\demo", null],
    ["", null],
  ];
  for (const [remote, expected] of cases) {
    const actual = parseGitRemoteWebLocation(remote);
    assert.deepEqual(
      actual ? { origin: actual.origin, path: actual.path } : null,
      expected,
      remote,
    );
  }
});

test("pull request URLs follow each provider's new-PR page", () => {
  assert.deepEqual(
    buildGitPullRequestLink({
      remoteUrl: "git@github.com:example/demo.git",
      headBranch: "feature/login",
      baseBranch: "main",
    }),
    {
      provider: "github",
      url: "https://github.com/example/demo/compare/main...feature/login?expand=1",
      headBranch: "feature/login",
      baseBranch: "main",
    },
  );
  assert.equal(
    buildGitPullRequestLink({
      remoteUrl: "https://github.example.com/org/repo.git",
      headBranch: "fix#1",
      baseBranch: null,
    })?.url,
    "https://github.example.com/org/repo/compare/fix%231?expand=1",
  );
  assert.equal(
    buildGitPullRequestLink({
      remoteUrl: "git@gitlab.com:group/repo.git",
      headBranch: "feat/a",
      baseBranch: "develop",
    })?.url,
    "https://gitlab.com/group/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fa&merge_request%5Btarget_branch%5D=develop",
  );
  assert.equal(
    buildGitPullRequestLink({
      remoteUrl: "https://bitbucket.org/team/repo.git",
      headBranch: "topic",
      baseBranch: "main",
    })?.url,
    "https://bitbucket.org/team/repo/pull-requests/new?source=topic&dest=main",
  );
});

test("unknown providers and base-branch pushes produce no link", () => {
  assert.equal(
    buildGitPullRequestLink({
      remoteUrl: "git@git.example.com:team/repo.git",
      headBranch: "topic",
      baseBranch: "main",
    }),
    null,
  );
  assert.equal(
    buildGitPullRequestLink({
      remoteUrl: "git@github.com:example/demo.git",
      headBranch: "main",
      baseBranch: "main",
    }),
    null,
  );
});
