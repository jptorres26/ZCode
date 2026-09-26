/**
 * 按目录结束终端并等待退出（删除 worktree 等目录前使用）。规范：docs/specs/git-worktree-task.md
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * 等待被结束的终端退出的上限。kill 已发出，这里只等操作系统回收进程；上限只保证删除流程不会无限挂起，
 * 超出后调用方继续删除，失败时由其重试入口处理。
 */
const TERMINAL_EXIT_WAIT_MS = 5_000;

/** 仍在 create() 中的终端：disposeUnderPath 标记取消并等待其结束。 */
export interface PendingTerminalCreate {
  cwd: string;
  cancelled: boolean;
  settled: Promise<void>;
}

export function waitForExitBounded(exited: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    exited.then(() => undefined),
    new Promise<void>((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, TERMINAL_EXIT_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * `child` 是否为 `parent` 自身或其下的路径；Windows 不区分大小写。导出供单测使用。
 * @lintignore
 */
export function isPathSameOrInside(child: string, parent: string, platform = process.platform) {
  const normalize = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  const relativePath = relative(normalize(parent), normalize(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

/** 删除中的目录：在调用方释放前拒绝在其下新建终端。键为请求路径，real 为其真实路径。 */
export type TerminalPathBlocks = Map<string, { count: number; real: string | null }>;

export function isTerminalPathBlocked(blocks: TerminalPathBlocks, cwd: string): boolean {
  for (const [raw, entry] of blocks) {
    if (isPathSameOrInside(cwd, raw) || (entry.real && isPathSameOrInside(cwd, entry.real))) {
      return true;
    }
  }
  return false;
}

/** create() 开始时调用：请求或实际 cwd 位于删除中的目录下时拒绝（目录已删除时实际 cwd 会回退到 HOME）。 */
export function assertTerminalCwdNotBlocked(
  blocks: TerminalPathBlocks,
  requestedCwd: string | undefined,
  resolvedCwd: string,
): void {
  if (
    (requestedCwd && isTerminalPathBlocked(blocks, resolve(requestedCwd))) ||
    isTerminalPathBlocked(blocks, resolve(resolvedCwd))
  ) {
    throw new Error(`Terminal was not started because '${requestedCwd}' is being removed`);
  }
}

/** 在 create() 的第一个 await 之前登记待创建终端；settle 在 create 结束（成功或失败）时调用。 */
export function registerPendingTerminalCreate(
  pendingCreates: Set<PendingTerminalCreate>,
  cwd: string,
): { pending: PendingTerminalCreate; settle: () => void } {
  let settle = () => {};
  const pending: PendingTerminalCreate = {
    cwd: resolve(cwd),
    cancelled: false,
    settled: new Promise<void>((resolveSettled) => {
      settle = resolveSettled;
    }),
  };
  pendingCreates.add(pending);
  return { pending, settle };
}

export function releaseTerminalPathBlock(blocks: TerminalPathBlocks, path: string): void {
  const raw = resolve(path);
  const entry = blocks.get(raw);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) blocks.delete(raw);
}

/**
 * 结束所有初始 cwd 位于 `path` 下的终端（含仍在创建中的），并等待它们退出；
 * 同时阻止在该目录下新建终端，直到调用方 releaseTerminalPathBlock。
 * 修复原因：只在两个时间点扫描待创建终端，等待期间仍挂载的 workspace 可以再开一个终端，删除时它又占用目录。
 * 修复依据：先登记目录封锁（同步，早于任何 await），新的 create 在开始时即被拒绝。
 */
export async function disposeTerminalsUnderPath(
  path: string,
  state: {
    pendingCreates: Iterable<PendingTerminalCreate>;
    terminals: Map<string, { cwd: string; exited: Promise<void> }>;
    cleanupTerminal: (id: string) => void;
    blocks: TerminalPathBlocks;
  },
): Promise<void> {
  const rawTarget = resolve(path);
  const block = state.blocks.get(rawTarget) ?? { count: 0, real: null };
  block.count += 1;
  state.blocks.set(rawTarget, block);
  // 先同步标记仍在创建中的终端，再等待 realpath，避免在此期间漏掉新开始的创建。
  const waits: Promise<void>[] = [];
  const cancelPendingUnder = (target: string) => {
    for (const pending of state.pendingCreates) {
      if (!pending.cancelled && isPathSameOrInside(pending.cwd, target)) {
        pending.cancelled = true;
        waits.push(pending.settled);
      }
    }
  };
  cancelPendingUnder(rawTarget);
  const target = await realpath(path).catch(() => rawTarget);
  block.real = target;
  cancelPendingUnder(target);
  for (const [id, terminal] of Array.from(state.terminals.entries())) {
    if (!isPathSameOrInside(terminal.cwd, target)) continue;
    state.cleanupTerminal(id);
    waits.push(terminal.exited);
  }
  if (waits.length > 0) {
    await waitForExitBounded(Promise.all(waits));
  }
}
