import assert from "node:assert/strict";
import test from "node:test";
import type { GitRemoveWorktreeResult } from "@zcode/shared";
import type { ToastOptions } from "../src/components/ui/toast.js";
import { removeManagedWorktree, type WorktreeRemovalParams } from "../src/lib/worktreeRemoval.js";

interface Harness {
  params: WorktreeRemovalParams;
  calls: string[];
  toasts: Array<{ message: string; options?: ToastOptions }>;
  set: (overrides: Partial<State>) => void;
}

interface State {
  otherEntriesOpen: boolean;
  disposeFails: boolean;
  released: boolean;
  removeResults: GitRemoveWorktreeResult[];
  leftoverOk: boolean;
}

function createHarness(initial: Partial<State> = {}): Harness {
  const state: State = {
    otherEntriesOpen: false,
    disposeFails: false,
    released: true,
    removeResults: [{ ok: true }],
    leftoverOk: true,
    ...initial,
  };
  const calls: string[] = [];
  const toasts: Harness["toasts"] = [];
  const params: WorktreeRemovalParams = {
    gitService: {
      removeWorktree: async ({ force }) => {
        calls.push(`remove(force=${String(force)})`);
        return state.removeResults.shift() ?? { ok: true };
      },
      removeWorktreeLeftover: async () => {
        calls.push("removeLeftover");
        return state.leftoverOk ? { ok: true } : { ok: false, reason: "failed", detail: "busy" };
      },
    },
    terminalService: {
      disposeUnderPath: async () => {
        calls.push("dispose");
        if (state.disposeFails) throw new Error("transport closed");
      },
      releasePathBlock: async () => {
        calls.push("unblock");
      },
    },
    releaseWorkspaceEntry: async (options) => {
      calls.push(`release(scan=${String(options?.scanReservedNames)})`);
      return state.released;
    },
    refuseIfOtherEntriesOpen: async () => {
      calls.push("check");
      return state.otherEntriesOpen;
    },
    notify: (message, options) => {
      toasts.push({ message, options });
    },
    intl: { formatMessage: ({ id }: { id?: string }) => id ?? "" } as WorktreeRemovalParams["intl"],
    workspacePath: "/wt/feat",
    worktreePath: "/wt/feat",
    branchName: "feat",
    force: false,
  };
  return { params, calls, toasts, set: (overrides) => Object.assign(state, overrides) };
}

/** 点击最后一条 toast 的操作按钮，等待重试完成。 */
async function clickLastToastAction(harness: Harness): Promise<void> {
  const onAction = harness.toasts.at(-1)?.options?.onAction;
  assert.ok(onAction, "the last toast offers an action");
  onAction();
  await new Promise((resolve) => setImmediate(resolve));
}

test("terminals end, the runtime is released, then the worktree is removed and unblocked", async () => {
  const harness = createHarness();
  await removeManagedWorktree(harness.params);
  assert.deepEqual(harness.calls, [
    "check",
    "dispose",
    "release(scan=false)",
    "remove(force=false)",
    "unblock",
  ]);
  assert.deepEqual(
    harness.toasts.map((toast) => toast.message),
    ["git.worktree.delete.done"],
  );
});

test("nothing is removed when the runtime release fails, and Retry runs every step again", async () => {
  const harness = createHarness({ released: false });
  await removeManagedWorktree(harness.params);
  assert.deepEqual(harness.calls, ["check", "dispose", "release(scan=false)", "unblock"]);
  assert.equal(harness.toasts.at(-1)?.message, "git.worktree.delete.releaseFailed");

  harness.set({ released: true });
  harness.calls.length = 0;
  await clickLastToastAction(harness);
  assert.deepEqual(harness.calls, [
    "check",
    "dispose",
    "release(scan=false)",
    "remove(force=false)",
    "unblock",
  ]);
});

test("nothing is released or removed when ending the terminals fails", async () => {
  const harness = createHarness({ disposeFails: true });
  await removeManagedWorktree(harness.params);
  assert.deepEqual(harness.calls, ["check", "dispose", "unblock"]);
  assert.equal(harness.toasts.at(-1)?.message, "git.worktree.delete.releaseFailed");
});

test("a retry is refused when the worktree was opened again in the meantime", async () => {
  const harness = createHarness({
    removeResults: [{ ok: false, reason: "failed", detail: "locked" }],
  });
  await removeManagedWorktree(harness.params);
  assert.equal(harness.toasts.at(-1)?.message, "git.worktree.delete.failedAfterRelease");

  harness.set({ otherEntriesOpen: true });
  harness.calls.length = 0;
  await clickLastToastAction(harness);
  assert.deepEqual(harness.calls, ["check"]);
});

test("failed, leftover and dirty retries end terminals and release again before removing", async () => {
  const harness = createHarness({
    removeResults: [
      { ok: false, reason: "failed", detail: "locked" },
      { ok: false, reason: "leftover", detail: "busy" },
    ],
    leftoverOk: false,
  });
  await removeManagedWorktree(harness.params);
  harness.calls.length = 0;
  await clickLastToastAction(harness);
  assert.deepEqual(harness.calls, [
    "check",
    "dispose",
    "release(scan=false)",
    "remove(force=false)",
    "unblock",
  ]);
  assert.equal(harness.toasts.at(-1)?.message, "git.worktree.delete.leftoverAfterRelease");

  harness.calls.length = 0;
  await clickLastToastAction(harness);
  assert.deepEqual(harness.calls, [
    "check",
    "dispose",
    "release(scan=false)",
    "removeLeftover",
    "unblock",
  ]);

  const dirty = createHarness({ removeResults: [{ ok: false, reason: "dirty" }] });
  await removeManagedWorktree(dirty.params);
  assert.equal(dirty.toasts.at(-1)?.message, "git.worktree.delete.dirtyAfterRelease");
  dirty.calls.length = 0;
  await clickLastToastAction(dirty);
  assert.deepEqual(dirty.calls, [
    "check",
    "dispose",
    "release(scan=false)",
    "remove(force=true)",
    "unblock",
  ]);
});
