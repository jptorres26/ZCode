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

test("a detached HEAD has no link", async () => {
  await withRepo(async (dir) => {
    await git(dir, "checkout", "-q", "--detach");
    assert.equal(await createGitCliRepo().getPullRequestLink(dir), null);
  });
});
