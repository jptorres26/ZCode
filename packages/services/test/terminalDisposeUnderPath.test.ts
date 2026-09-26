import assert from "node:assert/strict";
import test from "node:test";
import { isPathSameOrInside } from "../src/terminal/terminalDisposal.js";

test("terminals started in the folder or below it are matched, siblings are not", () => {
  assert.equal(isPathSameOrInside("/wt/repo-1/feat", "/wt/repo-1/feat", "linux"), true);
  assert.equal(
    isPathSameOrInside("/wt/repo-1/feat/packages/app", "/wt/repo-1/feat", "linux"),
    true,
  );
  assert.equal(isPathSameOrInside("/wt/repo-1/feat-2", "/wt/repo-1/feat", "linux"), false);
  assert.equal(isPathSameOrInside("/wt/repo-1", "/wt/repo-1/feat", "linux"), false);
  assert.equal(isPathSameOrInside("/home/me", "/wt/repo-1/feat", "linux"), false);
});

test("Windows paths compare case-insensitively", { skip: process.platform !== "win32" }, () => {
  assert.equal(isPathSameOrInside("C:\\WT\\Repo\\Feat\\src", "c:\\wt\\repo\\feat", "win32"), true);
  assert.equal(isPathSameOrInside("C:\\WT\\Repo\\Feat-2", "c:\\wt\\repo\\feat", "win32"), false);
});

test("disposal blocks new terminals under the folder until released, and cancels pending ones", async () => {
  const {
    assertTerminalCwdNotBlocked,
    disposeTerminalsUnderPath,
    registerPendingTerminalCreate,
    releaseTerminalPathBlock,
  } = await import("../src/terminal/terminalDisposal.js");
  const { mkdtemp, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = await mkdtemp(join(tmpdir(), "term-block-"));
  const worktree = join(base, "wt");
  await mkdir(join(worktree, "packages"), { recursive: true });

  const pendingCreates = new Set<
    import("../src/terminal/terminalDisposal.js").PendingTerminalCreate
  >();
  const { pending, settle } = registerPendingTerminalCreate(
    pendingCreates,
    join(worktree, "packages"),
  );
  const other = registerPendingTerminalCreate(pendingCreates, base);
  const cleaned: string[] = [];
  const blocks = new Map();
  const disposal = disposeTerminalsUnderPath(worktree, {
    pendingCreates,
    terminals: new Map([
      ["1", { cwd: worktree, exited: Promise.resolve() }],
      ["2", { cwd: base, exited: Promise.resolve() }],
    ]),
    cleanupTerminal: (id) => cleaned.push(id),
    blocks,
  });
  // 封锁在第一个 await 之前生效
  assert.throws(
    () => assertTerminalCwdNotBlocked(blocks, join(worktree, "packages"), "/"),
    /being removed/,
  );
  settle();
  await disposal;
  assert.equal(pending.cancelled, true);
  assert.equal(other.pending.cancelled, false);
  assert.deepEqual(cleaned, ["1"]);
  assert.doesNotThrow(() => assertTerminalCwdNotBlocked(blocks, base, base));
  assert.throws(() => assertTerminalCwdNotBlocked(blocks, worktree, worktree), /being removed/);

  releaseTerminalPathBlock(blocks, worktree);
  assert.doesNotThrow(() => assertTerminalCwdNotBlocked(blocks, worktree, worktree));
});
