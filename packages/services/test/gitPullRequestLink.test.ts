import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";

const execFileAsync = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
  (await execFileAsync("git", args, { cwd })).stdout;

async function withRepo(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-git-pr-link-"));
  try {
    await git(dir, "-c", "init.defaultBranch=main", "init", "-q");
    await git(dir, "config", "user.email", "tester@example.com");
    await git(dir, "config", "user.name", "Tester");
    await writeFile(join(dir, "a.txt"), "a\n");
    await git(dir, "add", ".");
    await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
    await git(dir, "remote", "add", "origin", "git@github.com:example/demo.git");
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a tracked feature branch links to the GitHub compare page against the remote HEAD", async () => {
  await withRepo(async (dir) => {
    const head = (await git(dir, "rev-parse", "HEAD")).trim();
    await git(dir, "update-ref", "refs/remotes/origin/main", head);
    await git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(dir, "checkout", "-q", "-b", "feature/login");
    await git(dir, "config", "branch.feature/login.remote", "origin");
    await git(dir, "config", "branch.feature/login.merge", "refs/heads/feature/login");

    assert.deepEqual(await createGitCliRepo().getPullRequestLink(dir), {
      provider: "github",
      url: "https://github.com/example/demo/compare/main...feature/login?expand=1",
      headBranch: "feature/login",
      baseBranch: "main",
    });
  });
});

test("branches without an upstream, or with a local upstream, have no link", async () => {
  await withRepo(async (dir) => {
    await git(dir, "checkout", "-q", "-b", "topic");
    assert.equal(await createGitCliRepo().getPullRequestLink(dir), null);
    await git(dir, "config", "branch.topic.remote", ".");
    await git(dir, "config", "branch.topic.merge", "refs/heads/main");
    assert.equal(await createGitCliRepo().getPullRequestLink(dir), null);
  });
});

test("a branch pushed to a fork links to the fork with the pushed branch", async () => {
  await withRepo(async (dir) => {
    const head = (await git(dir, "rev-parse", "HEAD")).trim();
    await git(dir, "update-ref", "refs/remotes/origin/main", head);
    await git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(dir, "remote", "add", "fork", "git@github.com:me/demo.git");
    await git(dir, "update-ref", "refs/remotes/fork/main", head);
    await git(dir, "symbolic-ref", "refs/remotes/fork/HEAD", "refs/remotes/fork/main");
    // 三角工作流：跟踪上游的 main，推送到 fork 的同名分支
    await git(dir, "checkout", "-q", "-b", "fix-typo");
    await git(dir, "config", "branch.fix-typo.remote", "origin");
    await git(dir, "config", "branch.fix-typo.merge", "refs/heads/main");
    // 只看上游时来源分支是 main，与默认分支相同，没有链接
    assert.equal(await createGitCliRepo().getPullRequestLink(dir), null);

    await git(dir, "config", "remote.pushDefault", "fork");
    const expected = {
      provider: "github",
      url: "https://github.com/me/demo/compare/main...fix-typo?expand=1",
      headBranch: "fix-typo",
      baseBranch: "main",
    };
    assert.deepEqual(await createGitCliRepo().getPullRequestLink(dir), expected);
    // branch.<name>.pushRemote 优先于 remote.pushDefault
    await git(dir, "config", "remote.pushDefault", "origin");
    await git(dir, "config", "branch.fix-typo.pushRemote", "fork");
    assert.deepEqual(await createGitCliRepo().getPullRequestLink(dir), expected);
  });
});

test("a remote with a separate push URL links to the repository pushed to", async () => {
  await withRepo(async (dir) => {
    const head = (await git(dir, "rev-parse", "HEAD")).trim();
    await git(dir, "update-ref", "refs/remotes/origin/main", head);
    await git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(dir, "remote", "set-url", "--push", "origin", "git@github.com:me/demo.git");
    await git(dir, "checkout", "-q", "-b", "feature/login");
    await git(dir, "config", "branch.feature/login.remote", "origin");
    await git(dir, "config", "branch.feature/login.merge", "refs/heads/feature/login");

    assert.equal(
      (await createGitCliRepo().getPullRequestLink(dir))?.url,
      "https://github.com/me/demo/compare/main...feature/login?expand=1",
    );
  });
});

test("a detached HEAD has no link", async () => {
  await withRepo(async (dir) => {
    await git(dir, "checkout", "-q", "--detach");
    assert.equal(await createGitCliRepo().getPullRequestLink(dir), null);
  });
});
