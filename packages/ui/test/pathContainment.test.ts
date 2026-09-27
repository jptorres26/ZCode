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
  assert.equal(
    await isSameOrInsideRealPath("/home/me/link", "/data/worktrees/feat", resolvePath),
    true,
  );
  assert.equal(await isSameOrInsideRealPath("/home/me/link", "/home/me/feat", resolvePath), true);
  assert.equal(
    await isSameOrInsideRealPath("/home/me/other", "/data/worktrees/feat", resolvePath),
    false,
  );
  // 入口路径已不存在：无法解析，视为不在其中；字面路径在其下时仍然匹配。
  assert.equal(await isSameOrInsideRealPath("/gone", "/data/worktrees/feat", resolvePath), false);
  assert.equal(
    await isSameOrInsideRealPath("/data/worktrees/feat/gone", "/data/worktrees/feat", resolvePath),
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
