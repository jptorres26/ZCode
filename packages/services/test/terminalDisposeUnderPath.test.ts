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
  const state = { pendingCreates: [], terminals: new Map(), cleanupTerminal: () => {}, blocks };
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
