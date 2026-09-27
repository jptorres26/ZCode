import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  // Windows 保留设备名（含扩展名形式）加前缀，普通名称不变
  for (const [branch, slug] of [
    ["con", "wt-con"],
    ["AUX", "wt-AUX"],
    ["com1", "wt-com1"],
    ["lpt9.fix", "wt-lpt9.fix"],
    ["nul/x", "nul-x"],
    ["console", "console"],
    ["com10", "com10"],
    ["fix/con", "fix-con"],
  ]) {
    assert.equal(toWorktreeSlug(branch), slug, branch);
  }
  // 过长的分支名截断并追加哈希，不同分支不相撞
  const long = (tail: string) =>
    ["a".repeat(100), "b".repeat(100), `c${tail}`.repeat(50)].join("/");
  const longSlug = toWorktreeSlug(long("1"));
  assert.ok(longSlug.length <= 80, longSlug);
  assert.match(longSlug, /^a+-[0-9a-f]{8}$/);
  assert.notEqual(longSlug, toWorktreeSlug(long("2")));
  assert.equal(toWorktreeSlug("x".repeat(80)), "x".repeat(80));
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
    // 已存在、未检出且指向 HEAD 的分支：失败后的回滚不能把它当成这次新建的分支删掉
    await git(repo, "branch", "idle");
    assert.equal((await gitRepo.createWorktree(repo, "idle")).ok, false);
    assert.equal(await git(repo, "branch", "--list", "idle"), "idle");

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
    assert.deepEqual(await gitRepo.removeWorktree(repo, { force: true }), {
      ok: false,
      reason: "not-managed",
    });
    // 用户在别处自建的 worktree 也不可删除
    const outside = join(repo, "..", "own-worktree");
    await git(repo, "worktree", "add", "-q", "-b", "own", outside);
    assert.equal(await gitRepo.getManagedWorktree(outside), null);
    // 用户手动放进 ZCode worktrees 目录的 worktree 没有创建标记，同样不可删除
    const imported = join(getWorktreeContainerDir(worktreesRootDir, repo), "imported");
    await git(repo, "worktree", "add", "-q", "-b", "imported", imported);
    assert.equal(await gitRepo.getManagedWorktree(imported), null);
    assert.deepEqual(await gitRepo.removeWorktree(imported, { force: true }), {
      ok: false,
      reason: "not-managed",
    });

    const created = await gitRepo.createWorktree(repo, "feature/x");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const managed = await gitRepo.getManagedWorktree(created.workspacePath);
    assert.match(managed?.instanceId ?? "", /^\d+:\d+:\d+$/);
    assert.deepEqual(managed, {
      worktreePath: created.worktreePath,
      mainWorktreePath: repo,
      branchName: "feature/x",
      hasUncommittedChanges: false,
      hasIgnoredFiles: false,
      instanceId: managed?.instanceId,
    });
    // 只有被忽略的文件（info/exclude 由主仓库与各 worktree 共用）：不算未提交改动，但单独报告
    await writeFile(join(repo, ".git", "info", "exclude"), ".env.local\n");
    await writeFile(join(created.worktreePath, ".env.local"), "TOKEN=local\n");
    const withIgnored = await gitRepo.getManagedWorktree(created.workspacePath);
    assert.equal(withIgnored?.hasUncommittedChanges, false);
    assert.equal(withIgnored?.hasIgnoredFiles, true);
    // 用户未同意删除被忽略的文件时不删除；只同意丢弃未提交改动也不够
    for (const options of [{ force: false }, { force: true }]) {
      assert.deepEqual(await gitRepo.removeWorktree(created.workspacePath, options), {
        ok: false,
        reason: "dirty",
      });
    }
    assert.equal(
      await readFile(join(created.worktreePath, ".env.local"), "utf-8"),
      "TOKEN=local\n",
    );
    // 只同意删除被忽略的文件，但确认后又出现了未提交改动：不删除
    await writeFile(join(created.worktreePath, "later.txt"), "new\n");
    assert.deepEqual(
      await gitRepo.removeWorktree(created.workspacePath, { force: false, discardIgnored: true }),
      { ok: false, reason: "dirty" },
    );
    await rm(join(created.worktreePath, "later.txt"));
    // 不是确认时的那个 worktree：不删除
    assert.deepEqual(
      await gitRepo.removeWorktree(created.workspacePath, {
        force: false,
        discardIgnored: true,
        expectedInstanceId: "0:0:0",
      }),
      { ok: false, reason: "changed" },
    );
    const removed = await gitRepo.removeWorktree(created.workspacePath, {
      force: false,
      discardIgnored: true,
      expectedInstanceId: withIgnored?.instanceId,
    });
    assert.equal(removed.ok, true);
  });
});

test("removing a managed worktree needs force when dirty and keeps the branch", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const gitRepo = createGitCliRepo({ worktreesRootDir });
    const created = await gitRepo.createWorktree(repo, "cleanup-me");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await writeFile(join(created.worktreePath, "scratch.txt"), "wip\n");
    assert.equal(
      (await gitRepo.getManagedWorktree(created.workspacePath))?.hasUncommittedChanges,
      true,
    );

    assert.deepEqual(await gitRepo.removeWorktree(created.workspacePath, { force: false }), {
      ok: false,
      reason: "dirty",
    });
    assert.ok(await exists(created.worktreePath));

    assert.deepEqual(await gitRepo.removeWorktree(created.workspacePath, { force: true }), {
      ok: true,
      mainWorktreePath: repo,
      branchName: "cleanup-me",
    });
    assert.equal(await exists(created.worktreePath), false);
    assert.equal(await worktreeCount(repo), 1);
    assert.equal(await git(repo, "branch", "--list", "cleanup-me"), "cleanup-me");
  });
});

test("a removal that fails after git dropped the registration reports a leftover that can be cleaned", async () => {
  const { createGitCommandProvider } = await import("../src/git/providers/gitCommandProvider.js");
  const { readManagedWorktree, removeLeftoverWorktreeDir, removeManagedWorktree } =
    await import("../src/git/repo/gitWorktree.js");
  await withRepo(async (repo, worktreesRootDir) => {
    const created = await createGitCliRepo({ worktreesRootDir }).createWorktree(repo, "locked");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const real = createGitCommandProvider();
    // 模拟 Windows 目录被占用：git 删掉了管理目录（登记消失），目录本身没删掉，命令失败
    const failingRemove = {
      resolveGitBinary: () => real.resolveGitBinary(),
      async run(options: Parameters<typeof real.run>[0]) {
        if (options.args[0] === "worktree" && options.args[1] === "remove") {
          const adminDir = await git(created.worktreePath, "rev-parse", "--absolute-git-dir");
          await rm(adminDir, { recursive: true, force: true });
          return {
            ...(await real.run({ ...options, args: ["--version"] })),
            exitCode: 255,
            stderr: "error: failed to delete",
          };
        }
        return await real.run(options);
      },
    };
    const worktree = await readManagedWorktree({
      commandProvider: real,
      worktreeRoot: created.worktreePath,
      worktreesRootDir,
    });
    assert.ok(worktree);
    const result = await removeManagedWorktree({
      commandProvider: failingRemove,
      worktree,
      force: true,
    });
    assert.equal(result.ok, false);
    if (result.ok || result.reason !== "leftover") throw new Error("expected a leftover");
    assert.equal(result.detail, "error: failed to delete");
    const { leftoverId } = result;
    assert.match(leftoverId, /^\d+:\d+:\d+$/);
    assert.ok(await exists(created.worktreePath));

    // 只清理 ZCode worktrees 目录下第二层、且已失效的检出
    const containerDir = getWorktreeContainerDir(worktreesRootDir, repo);
    const idOf = async (path: string) => {
      const stats = await lstat(path, { bigint: true });
      return `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`;
    };
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: containerDir,
        leftoverId: await idOf(containerDir),
        worktreesRootDir,
      }),
      { ok: false, reason: "not-leftover" },
    );
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: repo,
        leftoverId: await idOf(repo),
        worktreesRootDir,
      }),
      { ok: false, reason: "not-leftover" },
    );
    // 目录身份与失败时不同（另一个目录的 id）：不删除
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: created.worktreePath,
        leftoverId: await idOf(repo),
        worktreesRootDir,
      }),
      { ok: false, reason: "not-leftover" },
    );
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: created.worktreePath,
        leftoverId,
        worktreesRootDir,
      }),
      { ok: true },
    );
    assert.equal(await exists(created.worktreePath), false);
    assert.equal(await git(repo, "branch", "--list", "locked"), "locked");
    // 已不存在时重复清理也算成功
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: created.worktreePath,
        leftoverId,
        worktreesRootDir,
      }),
      { ok: true },
    );

    // 失败提示等待期间，该路径被换成新目录或指向另一个第二层目录的链接：都不删除
    await mkdir(created.worktreePath);
    await writeFile(join(created.worktreePath, "keep.txt"), "user data\n");
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: created.worktreePath,
        leftoverId,
        worktreesRootDir,
      }),
      { ok: false, reason: "not-leftover" },
    );
    assert.ok(await exists(join(created.worktreePath, "keep.txt")));
    await rm(created.worktreePath, { recursive: true });
    const sibling = join(containerDir, "other-dir");
    await mkdir(sibling);
    await symlink(sibling, created.worktreePath);
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: created.worktreePath,
        leftoverId: await idOf(sibling),
        worktreesRootDir,
      }),
      { ok: false, reason: "not-leftover" },
    );
    assert.ok(await exists(sibling));
  });
});

test("a live worktree is never treated as a leftover", async () => {
  const { removeLeftoverWorktreeDir } = await import("../src/git/repo/gitWorktree.js");
  await withRepo(async (repo, worktreesRootDir) => {
    const created = await createGitCliRepo({ worktreesRootDir }).createWorktree(repo, "live");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const stats = await lstat(created.worktreePath, { bigint: true });
    assert.deepEqual(
      await removeLeftoverWorktreeDir({
        worktreePath: created.worktreePath,
        leftoverId: `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`,
        worktreesRootDir,
      }),
      { ok: false, reason: "not-leftover" },
    );
    assert.ok(await exists(created.worktreePath));
  });
});

test("an unreadable worktree status needs consent for both changes and ignored files", async () => {
  const { createGitCommandProvider } = await import("../src/git/providers/gitCommandProvider.js");
  const { readManagedWorktree, removeManagedWorktree } =
    await import("../src/git/repo/gitWorktree.js");
  await withRepo(async (repo, worktreesRootDir) => {
    const created = await createGitCliRepo({ worktreesRootDir }).createWorktree(repo, "unreadable");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await writeFile(join(created.worktreePath, ".gitignore"), ".env\n");
    await writeFile(join(created.worktreePath, ".env"), "SECRET=1\n");
    const real = createGitCommandProvider();
    // status 失败（退出码非 0）或输出超限（进程被结束前已退出为 0）
    const withStatus = (override: { exitCode: number | null; outputTruncated: boolean }) => ({
      resolveGitBinary: () => real.resolveGitBinary(),
      async run(options: Parameters<typeof real.run>[0]) {
        const result = await real.run(options);
        return options.args[0] === "status" ? { ...result, ...override, stdout: "" } : result;
      },
    });
    for (const override of [
      { exitCode: 128, outputTruncated: false },
      { exitCode: 0, outputTruncated: true },
    ]) {
      const commandProvider = withStatus(override);
      const worktree = await readManagedWorktree({
        commandProvider,
        worktreeRoot: created.worktreePath,
        worktreesRootDir,
      });
      assert.ok(worktree);
      assert.equal(worktree.statusUnknown, true);
      assert.equal(worktree.hasUncommittedChanges, true);
      assert.equal(worktree.hasIgnoredFiles, true);
      // 只同意丢弃改动：不能带 --force 删掉未提示过的被忽略文件
      assert.deepEqual(await removeManagedWorktree({ commandProvider, worktree, force: true }), {
        ok: false,
        reason: "dirty",
      });
      assert.ok(await exists(join(created.worktreePath, ".env")));
    }
    // 读取正常时不标出 statusUnknown
    const readable = await readManagedWorktree({
      commandProvider: real,
      worktreeRoot: created.worktreePath,
      worktreesRootDir,
    });
    assert.equal(readable?.statusUnknown, undefined);
    assert.equal(readable?.hasIgnoredFiles, true);
  });
});

test("a failed worktree add is rolled back so the same branch name can be retried", async () => {
  await withRepo(async (repo, worktreesRootDir) => {
    const gitRepo = createGitCliRepo({ worktreesRootDir });
    const slugDir = join(getWorktreeContainerDir(worktreesRootDir, repo), "retry-me");
    // 检出失败（smudge 过滤器出错）：git 清理了目录，却留下了检出前建好的新分支
    await writeFile(join(repo, ".gitattributes"), "*.txt filter=boom\n");
    await git(repo, "add", ".gitattributes");
    await git(repo, "commit", "-q", "-m", "attrs");
    await git(repo, "config", "filter.boom.clean", "cat");
    await git(repo, "config", "filter.boom.smudge", "false");
    await git(repo, "config", "filter.boom.required", "true");
    assert.equal((await gitRepo.createWorktree(repo, "retry-me")).ok, false);
    assert.equal(await git(repo, "branch", "--list", "retry-me"), "");
    assert.equal(await worktreeCount(repo), 1);
    assert.equal(await exists(slugDir), false);
    await git(repo, "config", "--unset", "filter.boom.smudge");
    await git(repo, "config", "--unset", "filter.boom.required");

    if (process.platform !== "win32") {
      // 检出后 post-checkout 钩子失败：worktree 已登记并检出了新分支，同样整体回滚
      const hook = join(repo, ".git", "hooks", "post-checkout");
      await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      assert.equal((await gitRepo.createWorktree(repo, "retry-me")).ok, false);
      assert.equal(await git(repo, "branch", "--list", "retry-me"), "");
      assert.equal(await worktreeCount(repo), 1);
      assert.equal(await exists(slugDir), false);
      await rm(hook);
    }

    const created = await gitRepo.createWorktree(repo, "retry-me");
    assert.equal(created.ok, true);
    if (created.ok) assert.equal(created.worktreePath, slugDir);
  });
});

test("a failed branch lookup never lets the rollback delete an existing branch", async () => {
  const { createGitCommandProvider } = await import("../src/git/providers/gitCommandProvider.js");
  const { addGitWorktree } = await import("../src/git/repo/gitWorktree.js");
  await withRepo(async (repo, worktreesRootDir) => {
    // 已有分支指向 HEAD 且未检出；分支查询超时，看起来像“不存在”
    await git(repo, "branch", "idle");
    const real = createGitCommandProvider();
    const commandProvider = {
      resolveGitBinary: () => real.resolveGitBinary(),
      async run(options: Parameters<typeof real.run>[0]) {
        const result = await real.run(options);
        return options.args[0] === "rev-parse" && options.args.includes("refs/heads/idle^{commit}")
          ? { ...result, exitCode: null, timedOut: true, stdout: "" }
          : result;
      },
    };
    const result = await addGitWorktree({
      commandProvider,
      repoRoot: repo,
      workspaceInRepoPath: ".",
      branchName: "idle",
      worktreesRootDir,
    });
    assert.equal(result.ok, false);
    assert.equal(await git(repo, "branch", "--list", "idle"), "idle");
  });
});

test("ignored files inside an initialized submodule need consent before removal", async () => {
  const { readManagedWorktree, removeManagedWorktree } =
    await import("../src/git/repo/gitWorktree.js");
  const { createGitCommandProvider } = await import("../src/git/providers/gitCommandProvider.js");
  await withRepo(async (repo, worktreesRootDir) => {
    const sub = join(repo, "..", "sub");
    await mkdir(sub);
    await git(sub, "-c", "init.defaultBranch=main", "init", "-q");
    await writeFile(join(sub, "f.txt"), "f\n");
    await git(sub, "add", ".");
    await git(sub, "-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-q", "-m", "sub");
    const created = await createGitCliRepo({ worktreesRootDir }).createWorktree(repo, "with-sub");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const wt = created.worktreePath;
    await git(wt, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sm");
    await git(wt, "commit", "-q", "-m", "add submodule");
    // 子模块自己的排除规则忽略 cache；顶层的 status --ignored 看不到它
    await writeFile(
      await git(join(wt, "sm"), "rev-parse", "--git-path", "info/exclude").then((p) =>
        p.startsWith("/") ? p : join(wt, "sm", p),
      ),
      "cache\n",
    );
    await writeFile(join(wt, "sm", "cache"), "local data\n");
    assert.equal(await git(wt, "status", "--porcelain", "--ignored"), "");
    // 顶层另有一处未提交改动：只同意丢弃改动时不能带 --force 删掉子模块里被忽略的文件
    await writeFile(join(wt, "a.txt"), "changed\n");
    const commandProvider = createGitCommandProvider();
    const worktree = await readManagedWorktree({
      commandProvider,
      worktreeRoot: wt,
      worktreesRootDir,
    });
    assert.ok(worktree);
    assert.equal(worktree.hasIgnoredFiles, true);
    assert.equal(worktree.statusUnknown, undefined);
    assert.deepEqual(await removeManagedWorktree({ commandProvider, worktree, force: true }), {
      ok: false,
      reason: "dirty",
    });
    assert.ok(await exists(join(wt, "sm", "cache")));
  });
});
