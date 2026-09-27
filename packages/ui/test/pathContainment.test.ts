import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrInsidePath } from "../src/lib/path.js";

test("workspace paths inside a worktree are matched, siblings sharing a prefix are not", () => {
  assert.equal(isSameOrInsidePath("/wt/repo-1/feat", "/wt/repo-1/feat"), true);
  assert.equal(isSameOrInsidePath("/wt/repo-1/feat/packages/app", "/wt/repo-1/feat/"), true);
  assert.equal(isSameOrInsidePath("/wt/repo-1/feat-2", "/wt/repo-1/feat"), false);
  assert.equal(isSameOrInsidePath("/wt/repo-1", "/wt/repo-1/feat"), false);
  assert.equal(isSameOrInsidePath("C:\\WT\\Repo\\Feat\\src", "c:/wt/repo/feat"), true);
  assert.equal(isSameOrInsidePath("C:\\WT\\Repo\\Feat-2", "c:\\wt\\repo\\feat"), false);
});

test("an entry opened through a symlink or junction is matched by its real path", async () => {
  const { isSameOrInsideRealPath } = await import("../src/lib/path.js");
  // /home/me/link -> /data/worktrees/feat/packages；/home/me/feat -> /data/worktrees/feat
  const realPaths: Record<string, string> = {
    "/home/me/link": "/data/worktrees/feat/packages",
    "/home/me/feat": "/data/worktrees/feat",
    "/data/worktrees/feat": "/data/worktrees/feat",
    "/home/me/other": "/data/other",
  };
  const resolvePath = async (path: string) => {
    const real = realPaths[path];
    if (!real) throw new Error(`ENOENT: ${path}`);
    return real;
  };
  const worktree = ["/data/worktrees/feat"];
  // worktree 本身经链接打开：调用方传入字面路径与真实路径
  const linkedWorktree = ["/home/me/feat", "/data/worktrees/feat"];
  assert.equal(await isSameOrInsideRealPath("/home/me/link", worktree, resolvePath), true);
  assert.equal(await isSameOrInsideRealPath("/home/me/link", linkedWorktree, resolvePath), true);
  assert.equal(
    await isSameOrInsideRealPath("/home/me/feat/src", linkedWorktree, resolvePath),
    true,
  );
  assert.equal(await isSameOrInsideRealPath("/home/me/other", worktree, resolvePath), false);
  // 入口路径无法解析：返回 null（无法判断，由调用方再按所在 worktree 判断）；字面路径在其下时仍然匹配。
  assert.equal(await isSameOrInsideRealPath("/gone", worktree, resolvePath), null);
  assert.equal(
    await isSameOrInsideRealPath("/data/worktrees/feat/gone", worktree, resolvePath),
    true,
  );
});

test("an entry that can't be classified counts as inside the worktree", async () => {
  const { isEntryInsideWorktree } = await import("../src/lib/path.js");
  const worktree = "/data/worktrees/feat";
  const parents = [worktree];
  const failing = async () => {
    throw new Error("host unavailable");
  };
  const resolved = async (real: string) => real;
  // 两种方式都无法判断：按在其中处理
  assert.equal(
    await isEntryInsideWorktree("/home/me/alias", worktree, parents, {
      resolvePath: failing,
      readManagedWorktreePath: failing,
    }),
    true,
  );
  // 路径已解析到 worktree 外，读取所在 worktree 失败：不在其中
  assert.equal(
    await isEntryInsideWorktree("/home/me/other", worktree, parents, {
      resolvePath: () => resolved("/data/other"),
      readManagedWorktreePath: failing,
    }),
    false,
  );
  // 路径无法解析（如入口目录已删除），所在 worktree 读取成功且不是它：不在其中
  assert.equal(
    await isEntryInsideWorktree("/home/me/gone", worktree, parents, {
      resolvePath: failing,
      readManagedWorktreePath: async () => null,
    }),
    false,
  );
  // 真实路径识别不了的别名：按所在 worktree 判断
  assert.equal(
    await isEntryInsideWorktree("/mnt/bind/feat", worktree, parents, {
      resolvePath: () => resolved("/mnt/bind/feat"),
      readManagedWorktreePath: async () => worktree,
    }),
    true,
  );
});

test("runtime release reports failure instead of resolving as released", async () => {
  const { releaseWorkspaceRuntimeAfterProjectRemoval } =
    await import("../src/lib/workspaceRuntimeRelease.js");
  const tab = { workspacePath: "/data/worktrees/feat", workspaceIdentity: undefined };
  const released = await releaseWorkspaceRuntimeAfterProjectRemoval({
    tab,
    zcodeTaskService: { releaseWorkspacePreparation: async () => undefined },
  });
  assert.equal(released, true);
  const failed = await releaseWorkspaceRuntimeAfterProjectRemoval({
    tab,
    zcodeTaskService: {
      releaseWorkspacePreparation: async () => {
        throw new Error("host disconnected");
      },
    },
  });
  assert.equal(failed, false);
});
