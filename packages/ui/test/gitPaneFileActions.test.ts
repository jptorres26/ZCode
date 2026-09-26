import assert from "node:assert/strict";
import test from "node:test";
import type { GitChangeSectionId } from "@zcode/shared";
import {
  getGitPaneBulkActionPlan,
  getGitPaneFileActions,
  isGitPaneDiscardStaged,
  type GitPaneFileActionContext,
} from "../src/GitPane/fileActions.js";

function change(path: string, section: GitChangeSectionId, flags: { untracked?: boolean } = {}) {
  return {
    path,
    section,
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
    discardUntrackedCount: 1,
  });
  assert.deepEqual(getGitPaneBulkActionPlan([change("a.ts", "staged")], ready("staged")), {
    stagePaths: [],
    unstagePaths: ["a.ts"],
    discardPaths: ["a.ts"],
    discardUntrackedCount: 0,
  });
});
