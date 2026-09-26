/**
 * 按目录结束终端并等待退出（删除 worktree 等目录前使用）。规范：docs/specs/git-worktree-task.md
 */
import { realpath, stat } from "node:fs/promises";
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

/**
 * 删除中的目录：在调用方释放前拒绝在其下新建终端。键为请求路径，real 为其真实路径，
 * identity 为封锁时该目录的设备号、inode 与创建时间（用于识别已失效的封锁）。
 */
export type TerminalPathBlocks = Map<
  string,
  { count: number; real: string | null; identity: string | null }
>;

async function readPathIdentity(path: string): Promise<string | null> {
  try {
    const stats = await stat(path, { bigint: true });
    // ext4、tmpfs 等会立即复用刚释放的 inode，同路径重建的目录 inode 可能相同；创建时间不随目录内容变化，可区分两者。
    return `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`;
  } catch {
    return null;
  }
}

/**
 * create() 在得到实际 cwd 后调用：请求、解析或真实 cwd 任一位于删除中的目录下时拒绝
 * （真实路径覆盖经符号链接到达同一目录的情况；目录已删除时解析 cwd 会回退到 HOME，因此也检查请求路径）。
 * 修复原因：封锁只由界面在删除结束后解除，界面重载或崩溃会让封锁留到 Host 退出，之后同一路径上新建的 worktree
 * 无法开终端。修复依据：被封锁的目录已不存在，或已是另一个目录（设备号/inode/创建时间不同）时，视为封锁失效并移除。
 */
export async function assertTerminalCwdAllowed(
  blocks: TerminalPathBlocks,
  cwds: Array<string | undefined>,
): Promise<void> {
  const candidates = cwds.filter((cwd): cwd is string => Boolean(cwd)).map((cwd) => resolve(cwd));
  for (const [raw, entry] of Array.from(blocks.entries())) {
    const matches = candidates.some(
      (cwd) => isPathSameOrInside(cwd, raw) || (entry.real && isPathSameOrInside(cwd, entry.real)),
    );
    if (!matches) continue;
    const current = await readPathIdentity(entry.real ?? raw);
    if (current === null || (entry.identity !== null && current !== entry.identity)) {
      blocks.delete(raw);
      continue;
    }
    throw new Error(`Terminal was not started because '${cwds[0] ?? raw}' is being removed`);
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
  const block = state.blocks.get(rawTarget) ?? { count: 0, real: null, identity: null };
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
  block.identity ??= await readPathIdentity(target);
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
