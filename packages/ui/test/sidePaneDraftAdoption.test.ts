import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptDraftSidePaneTabs,
  getVisibleSidePaneTabs,
  openTerminalSidePane,
  stampSidePaneTabsOwnership,
} from "../src/lib/workspaceSidePane.js";

test("tabs opened in a draft move to the session the draft becomes", () => {
  // 草稿态（ownerTaskId=null）在 /wt 打开 Setup 终端；另一条会话 task-a 已有自己的终端
  let state = stampSidePaneTabsOwnership(
    openTerminalSidePane(null, { id: "setup", title: "Setup", cwd: "/wt" }),
    { ownerTaskId: null, workspaceKey: "/wt" },
  );
  state = stampSidePaneTabsOwnership(
    openTerminalSidePane(state, { id: "other", title: "Terminal", cwd: "/wt" }),
    { ownerTaskId: "task-a", workspaceKey: "/wt" },
  );
  const visible = (ownerTaskId: string | null) =>
    getVisibleSidePaneTabs(state?.tabs ?? [], { workspaceKey: "/wt", ownerTaskId }).map(
      (tab) => tab.id,
    );
  assert.deepEqual(visible("task-new"), []);

  state = adoptDraftSidePaneTabs(state, { workspaceKey: "/wt", taskId: "task-new" });
  assert.deepEqual(visible("task-new"), ["setup"]);
  assert.deepEqual(visible("task-a"), ["other"]);
  assert.deepEqual(visible(null), []);
});

test("draft tabs of another workspace are left alone", () => {
  const state = stampSidePaneTabsOwnership(
    openTerminalSidePane(null, { id: "setup", title: "Setup", cwd: "/other" }),
    { ownerTaskId: null, workspaceKey: "/other" },
  );
  assert.equal(adoptDraftSidePaneTabs(state, { workspaceKey: "/wt", taskId: "task-new" }), state);
});
