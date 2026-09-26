import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { parseStagedRenameEntries, planGitPathMutation } from "../src/git/repo/gitPathMutations.js";
import type { GitStatusEntry } from "../src/git/repo/gitCliTypes.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function porcelain(cwd: string): Promise<string[]> {
  const stdout = await git(cwd, "status", "--porcelain=v1", "--untracked-files=all");
  return stdout.split("\n").filter((line) => line.length > 0);
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function createRepo(options: { commit: boolean }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-git-mutation-"));
  await git(dir, "-c", "init.defaultBranch=main", "init", "-q");
  await git(dir, "config", "user.email", "tester@example.com");
  await git(dir, "config", "user.name", "Tester");
  await git(dir, "config", "commit.gpgsign", "false");
  await writeFile(join(dir, "a.txt"), "a\n");
  await writeFile(join(dir, "b.txt"), "b\n");
  await writeFile(join(dir, ".gitignore"), "*.log\n");
  if (options.commit) {
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "init");
  }
  return dir;
}

function withRepo(
  name: string,
  options: { commit: boolean },
  body: (dir: string) => Promise<void>,
): void {
  test(name, async () => {
    const dir = await createRepo(options);
    try {
      await body(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

function entry(partial: Partial<GitStatusEntry> & { path: string }): GitStatusEntry {
  return {
    originalPath: null,
    kind: "modified",
    x: ".",
    y: "M",
    isUntracked: false,
    isConflicted: false,
    ...partial,
  };
}

test("planGitPathMutation classifies tracked, untracked, conflicted and rename origins", () => {
  const entries = [
    entry({ path: "src/a.ts" }),
    entry({ path: "new/", kind: "added", x: null, y: "?", isUntracked: true }),
    entry({ path: "b2.txt", originalPath: "b.txt", kind: "renamed", x: "R", y: "." }),
    entry({ path: "c.txt", x: "U", y: "U", isConflicted: true }),
  ];

  assert.deepEqual(
    planGitPathMutation(entries, ["src/a.ts", "new", "b2.txt", "c.txt"], {
      includeRenameOrigins: true,
    }),
    {
      trackedPaths: ["src/a.ts", "b2.txt", "b.txt", "c.txt"],
      untrackedPaths: ["new"],
      conflictedPaths: ["c.txt"],
    },
  );
  assert.deepEqual(
    planGitPathMutation(entries, ["b2.txt"], { includeRenameOrigins: false }).trackedPaths,
    ["b2.txt"],
  );
  // 请求路径位于折叠的未跟踪目录内部时，仍然按未跟踪处理。
  assert.deepEqual(
    planGitPathMutation(entries, ["new/deep/file.txt"], { includeRenameOrigins: true }),
    { trackedPaths: [], untrackedPaths: ["new/deep/file.txt"], conflictedPaths: [] },
  );
  // 状态里已经不存在的路径（UI 快照过期）没有可操作的变更，跳过以保持幂等。
  assert.deepEqual(planGitPathMutation([], ["gone.txt"], { includeRenameOrigins: true }), {
    trackedPaths: [],
    untrackedPaths: [],
    conflictedPaths: [],
  });
});

test("parseStagedRenameEntries reads rename pairs from git diff -z output", () => {
  assert.deepEqual(parseStagedRenameEntries("R100\0old name.txt\0dir\\new.txt\0R087\0a\0b\0"), [
    entry({ path: "dir/new.txt", originalPath: "old name.txt", kind: "renamed", x: "R", y: "." }),
    entry({ path: "b", originalPath: "a", kind: "renamed", x: "R", y: "." }),
  ]);
  assert.deepEqual(parseStagedRenameEntries(""), []);
});

withRepo("discard restores an unstaged modification", { commit: true }, async (dir) => {
  await writeFile(join(dir, "a.txt"), "changed\n");
  await createGitCliRepo().discard(dir, ["a.txt"], false);
  assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "a\n");
  assert.deepEqual(await porcelain(dir), []);
});

withRepo(
  "discard deletes untracked files without touching ignored files",
  { commit: true },
  async (dir) => {
    await writeFile(join(dir, "new.txt"), "new\n");
    await writeFile(join(dir, "keep.log"), "log\n");
    await writeFile(join(dir, "a.txt"), "changed\n");
    await createGitCliRepo().discard(dir, ["new.txt", "a.txt", "keep.log"], false);
    assert.equal(await exists(join(dir, "new.txt")), false);
    assert.equal(await exists(join(dir, "keep.log")), true);
    assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "a\n");
    assert.deepEqual(await porcelain(dir), []);
  },
);

withRepo("discard removes an untracked directory", { commit: true }, async (dir) => {
  await mkdir(join(dir, "gen", "deep"), { recursive: true });
  await writeFile(join(dir, "gen", "deep", "x.txt"), "x\n");
  await createGitCliRepo().discard(dir, ["gen"], false);
  assert.equal(await exists(join(dir, "gen", "deep", "x.txt")), false);
  assert.deepEqual(await porcelain(dir), []);
});

withRepo("discard of a staged rename restores the original path", { commit: true }, async (dir) => {
  await git(dir, "mv", "b.txt", "b2.txt");
  await createGitCliRepo().discard(dir, ["b2.txt"], true);
  assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "b\n");
  assert.equal(await exists(join(dir, "b2.txt")), false);
  assert.deepEqual(await porcelain(dir), []);
});

withRepo(
  "unstage of a staged rename leaves no staged deletion behind",
  { commit: true },
  async (dir) => {
    await git(dir, "mv", "b.txt", "b2.txt");
    await createGitCliRepo().unstage(dir, ["b2.txt"]);
    assert.deepEqual((await porcelain(dir)).sort(), [" D b.txt", "?? b2.txt"]);
  },
);

withRepo("discard rejects conflicted paths and changes nothing", { commit: true }, async (dir) => {
  await git(dir, "checkout", "-q", "-b", "other");
  await writeFile(join(dir, "a.txt"), "other\n");
  await git(dir, "commit", "-q", "-am", "other");
  await git(dir, "checkout", "-q", "main");
  await writeFile(join(dir, "a.txt"), "main\n");
  await writeFile(join(dir, "b.txt"), "dirty\n");
  await git(dir, "commit", "-q", "-m", "main", "--", "a.txt");
  await execFileAsync("git", ["merge", "-q", "other"], { cwd: dir }).catch(() => undefined);
  const conflictedContent = await readFile(join(dir, "a.txt"), "utf8");

  await assert.rejects(
    createGitCliRepo().discard(dir, ["a.txt", "b.txt"], false),
    /unresolved conflicts/,
  );
  assert.equal(await readFile(join(dir, "a.txt"), "utf8"), conflictedContent);
  assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "dirty\n");
});

withRepo(
  "unstage keeps the file in a repository without commits",
  { commit: false },
  async (dir) => {
    await git(dir, "add", "a.txt");
    await createGitCliRepo().unstage(dir, ["a.txt"]);
    assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "a\n");
    assert.ok((await porcelain(dir)).includes("?? a.txt"));
  },
);

withRepo(
  "discard of a staged file in a repository without commits removes it",
  { commit: false },
  async (dir) => {
    await git(dir, "add", "a.txt");
    await createGitCliRepo().discard(dir, ["a.txt"], true);
    assert.equal(await exists(join(dir, "a.txt")), false);
    assert.ok(!(await porcelain(dir)).some((line) => line.endsWith("a.txt")));
  },
);
