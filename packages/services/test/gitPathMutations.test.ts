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

withRepo(
  "discard reports an untracked folder whose nested repository git clean kept",
  { commit: true },
  async (dir) => {
    await mkdir(join(dir, "gen", "nested"), { recursive: true });
    await writeFile(join(dir, "gen", "x.txt"), "x\n");
    await git(join(dir, "gen", "nested"), "init", "-q");
    await writeFile(join(dir, "gen", "nested", "keep.txt"), "keep\n");
    await assert.rejects(
      createGitCliRepo().discard(dir, ["gen/"], false),
      /nested Git repository: gen$/,
    );
    // 仓库之外的内容已删除，嵌套仓库原样保留
    assert.equal(await exists(join(dir, "gen", "x.txt")), false);
    assert.equal(await exists(join(dir, "gen", "nested", "keep.txt")), true);
    assert.equal(await exists(join(dir, "gen", "nested", ".git")), true);
  },
);

withRepo(
  "a staged deletion with a file re-created at the same path is not discarded over it",
  { commit: true },
  async (dir) => {
    await git(dir, "rm", "-q", "a.txt");
    await writeFile(join(dir, "a.txt"), "replacement\n");
    // staged：恢复 HEAD 版本会覆盖重新创建的文件，拒绝且不改动任何内容
    await assert.rejects(
      createGitCliRepo().discard(dir, ["a.txt"], true),
      /a file exists at the same path[^:]*: a\.txt$/,
    );
    assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "replacement\n");
    assert.deepEqual(await porcelain(dir), ["D  a.txt", "?? a.txt"]);
    // unstaged：丢弃重新创建的未跟踪文件，保留已暂存的删除
    await createGitCliRepo().discard(dir, ["a.txt"], false);
    assert.equal(await exists(join(dir, "a.txt")), false);
    assert.deepEqual(await porcelain(dir), ["D  a.txt"]);
  },
);

withRepo(
  "a staged deletion of a tracked, ignored file re-created at the same path is not discarded over it",
  { commit: true },
  async (dir) => {
    // 已跟踪但被忽略的文件（如 .env）：重新创建后 status 里只有删除条目
    await writeFile(join(dir, ".env"), "SECRET=old\n");
    await git(dir, "add", "-f", ".env");
    await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "env");
    await writeFile(join(dir, ".gitignore"), "*.log\n.env\n");
    await git(dir, "rm", "-q", ".env");
    await writeFile(join(dir, ".env"), "SECRET=new\n");
    await assert.rejects(createGitCliRepo().discard(dir, [".env"], true), /same path[^:]*: \.env$/);
    assert.equal(await readFile(join(dir, ".env"), "utf8"), "SECRET=new\n");
  },
);

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
  "unstage works for a new file changed again after staging, in a repository without commits",
  { commit: false },
  async (dir) => {
    await git(dir, "add", "a.txt");
    await writeFile(join(dir, "a.txt"), "changed after staging\n");
    await createGitCliRepo().unstage(dir, ["a.txt"]);
    assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "changed after staging\n");
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

withRepo(
  "staged-only commit of a rename commits the deletion of the original path",
  { commit: true },
  async (dir) => {
    await git(dir, "mv", "b.txt", "b2.txt");
    await writeFile(join(dir, "a.txt"), "staged but not selected\n");
    await git(dir, "add", "a.txt");
    await createGitCliRepo().commit(dir, "rename b", ["b2.txt"], { stagedOnly: true });
    const tree = (await git(dir, "ls-tree", "--name-only", "HEAD")).split("\n").filter(Boolean);
    assert.ok(tree.includes("b2.txt"));
    assert.ok(!tree.includes("b.txt"), "original path must not survive in the commit");
    // 未选中的已暂存文件继续留在暂存区。
    assert.deepEqual(await porcelain(dir), ["M  a.txt"]);
  },
);

withRepo(
  "stage and discard act on a symlink itself, never on its target",
  { commit: true },
  async (dir) => {
    if (process.platform === "win32") return;
    const { symlink } = await import("node:fs/promises");
    const gitRepo = createGitCliRepo();
    // 未跟踪的目标目录里有未跟踪文件；link 是指向它的未跟踪符号链接
    await mkdir(join(dir, "target"));
    await writeFile(join(dir, "target", "keep.txt"), "keep\n");
    await symlink("target", join(dir, "link"));
    await symlink("a.txt", join(dir, "file-link"));

    await gitRepo.stage(dir, [join(dir, "file-link")]);
    assert.deepEqual(
      (await porcelain(dir)).filter((line) => line.includes("link") || line.includes("a.txt")),
      ["A  file-link", "?? link"],
    );

    await gitRepo.discard(dir, [join(dir, "link")], false);
    assert.equal(await exists(join(dir, "link")), false);
    assert.equal(await readFile(join(dir, "target", "keep.txt"), "utf-8"), "keep\n");
  },
);
