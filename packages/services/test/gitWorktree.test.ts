import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { getWorktreeContainerDir, toWorktreeSlug } from "../src/git/repo/gitWorktree.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function withRepo(body: (repo: string, worktreesRootDir: string) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "zcode-worktree-")));
  const repo = join(base, "my repo");
  const worktreesRootDir = join(base, "worktrees");
  await mkdir(join(repo, "packages", "app"), { recursive: true });
  await git(repo, "-c", "init.defaultBranch=main", "init", "-q");
  await git(repo, "config", "user.email", "tester@example.com");
  await git(repo, "config", "user.name", "Tester");
  await git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "a.txt"), "a\n");
  await writeFile(join(repo, "packages", "app", "index.ts"), "export {};\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-q", "-m", "init");
  try {
    await body(repo, worktreesRootDir);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function worktreeCount(repo: string): Promise<number> {
  return (await git(repo, "worktree", "list", "--porcelain"))
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
}

test("slugs keep safe characters and the container is keyed by the repo root", () => {
  assert.equal(toWorktreeSlug("feature/login page"), "feature-login-page");
  assert.equal(toWorktreeSlug("..//"), "worktree");
  const container = getWorktreeContainerDir("/wt", "/home/me/my repo");
  assert.match(container, /^\/wt\/my-repo-[0-9a-f]{8}$/);
  assert.notEqual(container, getWorktreeContainerDir("/wt", "/other/my repo"));
});

test("creates a worktree on a new branch outside the repo, without uncommitted changes", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    await writeFile(join(repo, "a.txt"), "uncommitted\n");
    const result = await createGitCliRepo({ worktreesRootDir }).createWorktree(
      repo,
      "feature/login",
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.branchName, "feature/login");
    assert.equal(result.workspacePath, result.worktreePath);
    assert.ok(result.worktreePath.startsWith(worktreesRootDir));
    assert.ok(result.worktreePath.endsWith("feature-login"));
    assert.equal(await git(result.worktreePath, "branch", "--show-current"), "feature/login");
    assert.equal(await readFile(join(result.worktreePath, "a.txt"), "utf8"), "a\n");
    // 原检出不受影响：分支不变，未提交改动仍在
    assert.equal(await git(repo, "branch", "--show-current"), "main");
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "uncommitted\n");
    assert.equal(await worktreeCount(repo), 2);
  });
});

test("a subdirectory workspace maps to the same subdirectory in the worktree", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const result = await createGitCliRepo({ worktreesRootDir }).createWorktree(
      join(repo, "packages", "app"),
      "sub-task",
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.workspacePath, join(result.worktreePath, "packages", "app"));
    assert.ok(await exists(join(result.workspacePath, "index.ts")));
  });
});

test("an existing directory for the slug gets a numeric suffix", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const container = getWorktreeContainerDir(worktreesRootDir, repo);
    await mkdir(join(container, "topic"), { recursive: true });
    const result = await createGitCliRepo({ worktreesRootDir }).createWorktree(repo, "topic");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.worktreePath, join(container, "topic-2"));
  });
});

test("existing or invalid branch names return an issue and add no worktree", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const gitRepo = createGitCliRepo({ worktreesRootDir });
    const existing = await gitRepo.createWorktree(repo, "main");
    assert.equal(existing.ok, false);
    if (!existing.ok) assert.equal(existing.issues[0]?.code, "branch-already-exists");

    for (const name of ["bad..name", "  ", "-x"]) {
      const invalid = await gitRepo.createWorktree(repo, name);
      assert.equal(invalid.ok, false, name);
      if (!invalid.ok) assert.equal(invalid.issues[0]?.code, "invalid-branch-name", name);
    }
    assert.equal(await worktreeCount(repo), 1);
  });
});

test("an uncommitted subdirectory workspace falls back to the worktree root", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const untracked = join(repo, "newpkg");
    await mkdir(untracked);
    await writeFile(join(untracked, "x.ts"), "x\n");
    const result = await createGitCliRepo({ worktreesRootDir }).createWorktree(
      untracked,
      "try-new",
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.workspacePath, result.worktreePath);
  });
});

test("a manually deleted worktree folder does not block creating one at the same path", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const gitRepo = createGitCliRepo({ worktreesRootDir });
    const first = await gitRepo.createWorktree(repo, "a/b");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    await rm(first.worktreePath, { recursive: true, force: true });
    // 与 a/b 同 slug（a-b），目录已删除但 Git 仍登记着它
    const second = await gitRepo.createWorktree(repo, "a-b");
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.equal(second.worktreePath, first.worktreePath);
    assert.equal(await worktreeCount(repo), 2);
  });
});

test("only ZCode-created linked worktrees are managed and removable", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const gitRepo = createGitCliRepo({ worktreesRootDir });
    // 主检出不可删除
    assert.equal(await gitRepo.getManagedWorktree(repo), null);
    assert.deepEqual(await gitRepo.removeWorktree(repo, true), {
      ok: false,
      reason: "not-managed",
    });
    // 用户在别处自建的 worktree 也不可删除
    const outside = join(repo, "..", "own-worktree");
    await git(repo, "worktree", "add", "-q", "-b", "own", outside);
    assert.equal(await gitRepo.getManagedWorktree(outside), null);

    const created = await gitRepo.createWorktree(repo, "feature/x");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const managed = await gitRepo.getManagedWorktree(created.workspacePath);
    assert.deepEqual(managed, {
      worktreePath: created.worktreePath,
      mainWorktreePath: repo,
      branchName: "feature/x",
    });
  });
});

test("removing a managed worktree needs force when dirty and keeps the branch", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const gitRepo = createGitCliRepo({ worktreesRootDir });
    const created = await gitRepo.createWorktree(repo, "cleanup-me");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await writeFile(join(created.worktreePath, "scratch.txt"), "wip\n");

    assert.deepEqual(await gitRepo.removeWorktree(created.workspacePath, false), {
      ok: false,
      reason: "dirty",
    });
    assert.ok(await exists(created.worktreePath));

    assert.deepEqual(await gitRepo.removeWorktree(created.workspacePath, true), {
      ok: true,
      mainWorktreePath: repo,
      branchName: "cleanup-me",
    });
    assert.equal(await exists(created.worktreePath), false);
    assert.equal(await worktreeCount(repo), 1);
    assert.equal(await git(repo, "branch", "--list", "cleanup-me"), "cleanup-me");
  });
});
