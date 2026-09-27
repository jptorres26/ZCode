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
    assertTerminalCwdAllowed,
    disposeTerminalsUnderPath,
    registerPendingTerminalCreate,
    releaseTerminalPathBlock,
  } = await import("../src/terminal/terminalDisposal.js");
  const { mkdtemp, mkdir, symlink } = await import("node:fs/promises");
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
    exiting: new Map(),
    blocks,
  });
  // 封锁在第一个 await 之前生效
  await assert.rejects(
    assertTerminalCwdAllowed(blocks, [join(worktree, "packages")]),
    /being removed/,
  );
  settle();
  await disposal;
  assert.equal(pending.cancelled, true);
  assert.equal(other.pending.cancelled, false);
  assert.deepEqual(cleaned, ["1"]);
  await assertTerminalCwdAllowed(blocks, [base]);
  await assert.rejects(assertTerminalCwdAllowed(blocks, [worktree]), /being removed/);
  // 经符号链接到达同一目录（真实路径匹配）同样被拒绝
  if (process.platform !== "win32") {
    await symlink(worktree, join(base, "alias"));
    await assert.rejects(
      assertTerminalCwdAllowed(blocks, [join(base, "alias"), join(base, "alias"), worktree]),
      /being removed/,
    );
  }

  releaseTerminalPathBlock(blocks, worktree);
  await assertTerminalCwdAllowed(blocks, [worktree]);
});

test("a block whose folder is gone or was replaced is dropped instead of blocking forever", async () => {
  const { assertTerminalCwdAllowed, disposeTerminalsUnderPath } =
    await import("../src/terminal/terminalDisposal.js");
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = await mkdtemp(join(tmpdir(), "term-stale-"));
  const worktree = join(base, "wt");
  await mkdir(worktree);
  const blocks = new Map();
  const state = {
    pendingCreates: [],
    terminals: new Map(),
    cleanupTerminal: () => {},
    exiting: new Map(),
    blocks,
  };
  // 界面在删除中途重载：封锁从未解除
  await disposeTerminalsUnderPath(worktree, state);
  await rm(worktree, { recursive: true });
  await mkdir(worktree); // 之后同一路径上新建的 worktree 是另一个目录
  await assertTerminalCwdAllowed(blocks, [worktree]);
  assert.equal(blocks.size, 0);

  await disposeTerminalsUnderPath(worktree, state);
  await rm(worktree, { recursive: true });
  await assertTerminalCwdAllowed(blocks, [worktree]);
  assert.equal(blocks.size, 0);
});

test("disposal fails when a terminal doesn't exit in time, and a retry kills it again", async () => {
  const { disposeTerminalsUnderPath, registerPendingTerminalCreate, releaseTerminalPathBlock } =
    await import("../src/terminal/terminalDisposal.js");
  type Exiting = import("../src/terminal/terminalDisposal.js").ExitingTerminals;
  const worktree = "/wt/repo-1/stuck";
  let markExited = () => {};
  const exited = new Promise<void>((resolve) => {
    markExited = resolve;
  });
  let kills = 0;
  const exiting: Exiting = new Map();
  const terminals = new Map([["1", { cwd: worktree, exited }]]);
  const blocks = new Map();
  const state = {
    pendingCreates: [],
    terminals,
    // 与终端服务一致：kill 后从终端表移到 exiting，直到退出
    cleanupTerminal: (id: string) => {
      const terminal = terminals.get(id)!;
      kills += 1;
      exiting.set(id, { cwd: terminal.cwd, exited: terminal.exited, kill: () => (kills += 1) });
      terminals.delete(id);
    },
    exiting,
    blocks,
    exitWaitMs: 20,
  };
  await assert.rejects(disposeTerminalsUnderPath(worktree, state), /did not exit in time/);
  releaseTerminalPathBlock(blocks, worktree);
  assert.equal(blocks.size, 0);
  // 重试：终端已不在终端表中，但仍在 exiting 中，会再次结束并等待
  await assert.rejects(disposeTerminalsUnderPath(worktree, state), /did not exit in time/);
  assert.equal(kills, 2);
  releaseTerminalPathBlock(blocks, worktree);
  markExited();
  exiting.clear();
  await disposeTerminalsUnderPath(worktree, state);
  releaseTerminalPathBlock(blocks, worktree);

  // 仍在创建中的终端被取消后未在上限内退出
  const pendingCreates = new Set<
    import("../src/terminal/terminalDisposal.js").PendingTerminalCreate
  >();
  const { pending, settle } = registerPendingTerminalCreate(pendingCreates, worktree);
  const disposal = disposeTerminalsUnderPath(worktree, { ...state, pendingCreates });
  await new Promise((resolve) => setImmediate(resolve));
  pending.exitTimedOut = true;
  settle();
  await assert.rejects(disposal, /did not exit in time/);
});

test("a new deletion at a path with a stale block keeps the folder blocked", async () => {
  const { assertTerminalCwdAllowed, disposeTerminalsUnderPath, releaseTerminalPathBlock } =
    await import("../src/terminal/terminalDisposal.js");
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = await mkdtemp(join(tmpdir(), "term-reblock-"));
  const worktree = join(base, "wt");
  await mkdir(worktree);
  const blocks = new Map();
  const state = {
    pendingCreates: [],
    terminals: new Map(),
    cleanupTerminal: () => {},
    exiting: new Map(),
    blocks,
  };
  // 上一次删除的封锁未解除（界面重载），之后同一路径上建了新的 worktree
  await disposeTerminalsUnderPath(worktree, state);
  await rm(worktree, { recursive: true });
  await mkdir(worktree);
  // 新的删除：旧 lease 被移除，新 lease 按当前目录生效，新建终端仍被拒绝
  await disposeTerminalsUnderPath(worktree, state);
  await assert.rejects(assertTerminalCwdAllowed(blocks, [worktree]), /being removed/);
  releaseTerminalPathBlock(blocks, worktree);
  await assertTerminalCwdAllowed(blocks, [worktree]);
  assert.equal(blocks.size, 0);
});

test("a child folder whose name starts with two dots is inside the worktree", async () => {
  const { isRelativePathInside } = await import("../src/fs/pathContainment.js");
  assert.equal(isPathSameOrInside("/wt/feat/..cache", "/wt/feat", "linux"), true);
  assert.equal(isPathSameOrInside("/wt/feat/..cache/x", "/wt/feat", "linux"), true);
  assert.equal(isPathSameOrInside("/wt/feat/../other", "/wt/feat", "linux"), false);
  assert.equal(isRelativePathInside("..cache"), true);
  assert.equal(isRelativePathInside(".."), false);
  assert.equal(isRelativePathInside("../x"), false);
  assert.equal(isRelativePathInside(""), true);
});
