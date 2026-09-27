import assert from "node:assert/strict";
import test from "node:test";
import type { GitChangeSectionId } from "@zcode/shared";
import {
  getGitPaneBulkActionPlan,
  getGitPaneFileActions,
  isGitPaneDiscardStaged,
  type GitPaneFileActionContext,
} from "../src/GitPane/fileActions.js";

function change(
  path: string,
  section: GitChangeSectionId,
  flags: { untracked?: boolean; kind?: "modified" | "added" | "deleted" | "renamed" } = {},
) {
  return {
    // 与服务端一致：绝对路径经 resolve 后去掉末尾 `/`，repoRelativePath 保留 git 原样输出
    path: path.replace(/\/$/, ""),
    repoRelativePath: path,
    section,
    kind: flags.kind ?? "modified",
    isConflicted: section === "conflicted",
    isUntracked: flags.untracked === true,
  };
}

const ready = (sourceId: GitPaneFileActionContext["sourceId"]): GitPaneFileActionContext => ({
  sourceId,
  datasetReadonly: sourceId === "branch" || sourceId === "last-turn",
  repositoryReady: true,
});

test("unstaged changes can be staged or discarded; conflicts can only be staged", () => {
  assert.deepEqual(getGitPaneFileActions(change("a.ts", "unstaged"), ready("unstaged")), [
    "stage",
    "discard",
  ]);
  assert.deepEqual(
    getGitPaneFileActions(change("n.ts", "untracked", { untracked: true }), ready("unstaged")),
    ["stage", "discard"],
  );
  assert.deepEqual(getGitPaneFileActions(change("c.ts", "conflicted"), ready("unstaged")), [
    "stage",
  ]);
});

test("staged changes can be unstaged or discarded", () => {
  assert.deepEqual(getGitPaneFileActions(change("a.ts", "staged"), ready("staged")), [
    "unstage",
    "discard",
  ]);
  assert.equal(isGitPaneDiscardStaged("staged"), true);
  assert.equal(isGitPaneDiscardStaged("unstaged"), false);
});

test("read-only sources and unavailable repositories expose no actions", () => {
  assert.deepEqual(getGitPaneFileActions(change("a.ts", "branch"), ready("branch")), []);
  assert.deepEqual(getGitPaneFileActions(change("a.ts", "last-turn"), ready("last-turn")), []);
  assert.deepEqual(
    getGitPaneFileActions(change("a.ts", "unstaged"), {
      ...ready("unstaged"),
      repositoryReady: false,
    }),
    [],
  );
  assert.deepEqual(
    getGitPaneFileActions(change("a.ts", "unstaged"), {
      ...ready("unstaged"),
      datasetReadonly: true,
    }),
    [],
  );
});

test("bulk discard skips conflicts and counts untracked deletions", () => {
  const plan = getGitPaneBulkActionPlan(
    [
      change("a.ts", "unstaged"),
      change("n.ts", "untracked", { untracked: true }),
      change("c.ts", "conflicted"),
    ],
    ready("unstaged"),
  );
  assert.deepEqual(plan, {
    stagePaths: ["a.ts", "n.ts", "c.ts"],
    unstagePaths: [],
    discardPaths: ["a.ts", "n.ts"],
    discardDeletedFileCount: 1,
    discardDeletedFolderCount: 0,
  });
  assert.deepEqual(
    getGitPaneBulkActionPlan(
      [change("a.ts", "staged"), change("new.ts", "staged", { kind: "added" })],
      ready("staged"),
    ),
    {
      stagePaths: [],
      unstagePaths: ["a.ts", "new.ts"],
      discardPaths: ["a.ts", "new.ts"],
      discardDeletedFileCount: 1,
      discardDeletedFolderCount: 0,
    },
  );
});

test("a collapsed untracked directory counts as a folder, not as one file", async () => {
  const { getGitPaneDiscardDeletion } = await import("../src/GitPane/fileActions.js");
  const plan = getGitPaneBulkActionPlan(
    [
      change("build/", "untracked", { untracked: true }),
      change("n.ts", "untracked", { untracked: true }),
      change("a.ts", "unstaged"),
    ],
    ready("unstaged"),
  );
  assert.equal(plan.discardDeletedFolderCount, 1);
  assert.equal(plan.discardDeletedFileCount, 1);
  assert.equal(
    getGitPaneDiscardDeletion(change("build/", "untracked", { untracked: true }), "unstaged"),
    "folder",
  );
  assert.equal(
    getGitPaneDiscardDeletion(change("n.ts", "untracked", { untracked: true }), "unstaged"),
    "file",
  );
  assert.equal(getGitPaneDiscardDeletion(change("a.ts", "unstaged"), "unstaged"), null);
});

test("collapsed untracked folders and deleted files can't be opened in the viewer", async () => {
  const { canOpenGitPaneChangeInViewer } = await import("../src/GitPane/fileActions.js");
  assert.equal(
    canOpenGitPaneChangeInViewer(change("build/", "untracked", { untracked: true, kind: "added" })),
    false,
  );
  assert.equal(
    canOpenGitPaneChangeInViewer(change("gone.ts", "unstaged", { kind: "deleted" })),
    false,
  );
  assert.equal(
    canOpenGitPaneChangeInViewer(change("n.ts", "untracked", { untracked: true, kind: "added" })),
    true,
  );
  assert.equal(canOpenGitPaneChangeInViewer(change("a.ts", "unstaged")), true);
  // 子模块在工作区中是目录：status 把它报为普通的 modified 条目，由 isSubmodule 区分。
  assert.equal(
    canOpenGitPaneChangeInViewer({ ...change("vendor/lib", "unstaged"), isSubmodule: true }),
    false,
  );
  // `MD`：kind 按 index 一侧为 modified，但工作区中已没有该文件
  assert.equal(
    canOpenGitPaneChangeInViewer({ ...change("gone.ts", "staged"), isMissingInWorkingTree: true }),
    false,
  );
});
