/**
 * 按目录结束终端并等待退出（删除 worktree 等目录前使用）。规范：docs/specs/git-worktree-task.md
 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * 等待被结束的终端退出的上限。kill 已发出，这里只等操作系统回收进程；上限只保证删除流程不会无限挂起。
 * 修复原因：超时以前与确认退出一样返回成功，删除会在进程仍以该目录为 cwd 时继续。
 * 修复依据：超时即失败（TERMINALS_DID_NOT_EXIT），调用方不删除目录，由其重试入口再次结束终端。
 */
const TERMINAL_EXIT_WAIT_MS = 5_000;

/** 终端在等待上限内未退出时 disposeTerminalsUnderPath 的错误信息（不带路径）。 */
const TERMINALS_DID_NOT_EXIT = "Terminals in the folder did not exit in time";

/** 在删除中的目录下新建终端时的错误信息。 */
const TERMINAL_FOLDER_BEING_REMOVED =
  "Terminal was not started because its folder is being removed";

/**
 * 已发出 kill 但尚未退出的终端（按 id）。退出后移除；disposeUnderPath 会再次结束并等待其中位于该目录下的终端，
 * 这样一次超时之后的重试不会因为终端已从终端表移除而漏掉仍在运行的进程。
 */
export type ExitingTerminals = Map<
  string,
  { cwd: string; exited: Promise<void>; kill: () => void }
>;

/** 发出 kill 之后调用：登记到 exiting，直到进程退出。 */
export function trackTerminalUntilExited(
  exiting: ExitingTerminals,
  id: string,
  terminal: { cwd: string; exited: Promise<void>; pty: { kill: () => void } },
): void {
  exiting.set(id, {
    cwd: terminal.cwd,
    exited: terminal.exited,
    kill: () => {
      try {
        terminal.pty.kill();
      } catch {
        // 进程已退出
      }
    },
  });
  void terminal.exited.then(() => exiting.delete(id));
}

/**
 * 仍在 create() 中的终端：disposeUnderPath 标记取消并等待其结束。
 * 被取消的终端在等待上限内未退出时 create() 置 exitTimedOut（进程已登记在 ExitingTerminals 中）。
 */
export interface PendingTerminalCreate {
  cwd: string;
  cancelled: boolean;
  exitTimedOut: boolean;
  settled: Promise<void>;
}

/** 等待 `exited`，最多 `timeoutMs`；返回是否确认退出（false 表示超时）。 */
function waitForExitBounded(
  exited: Promise<unknown>,
  timeoutMs = TERMINAL_EXIT_WAIT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), timeoutMs);
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
    // 不带路径：该错误会被终端界面按 error 级别记录，路径含用户名。
    throw new Error(TERMINAL_FOLDER_BEING_REMOVED);
  }
}

/**
 * create() 在 spawn 之后发现已被取消时调用：结束进程并等待其退出（上限内），始终 reject。
 * 未在上限内退出时置 exitTimedOut；进程仍登记在 exiting 中，下一次 disposeUnderPath 会再次结束并等待它。
 */
export async function rejectCancelledTerminalCreate(
  pending: PendingTerminalCreate,
  exiting: ExitingTerminals,
  id: string,
  terminal: { cwd: string; exited: Promise<void>; pty: { kill: () => void } },
): Promise<never> {
  terminal.pty.kill();
  trackTerminalUntilExited(exiting, id, terminal);
  pending.exitTimedOut = !(await waitForExitBounded(terminal.exited));
  throw new Error(TERMINAL_FOLDER_BEING_REMOVED);
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
    exitTimedOut: false,
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
 * 结束所有初始 cwd 位于 `path` 下的终端（含仍在创建中的），并等待它们退出；任一终端在等待上限内未退出时 reject。
 * 同时阻止在该目录下新建终端，直到调用方 releaseTerminalPathBlock（reject 时同样需要解除）。
 * 修复原因：只在两个时间点扫描待创建终端，等待期间仍挂载的 workspace 可以再开一个终端，删除时它又占用目录。
 * 修复依据：先登记目录封锁（同步，早于任何 await），新的 create 在开始时即被拒绝。
 */
export async function disposeTerminalsUnderPath(
  path: string,
  state: {
    pendingCreates: Iterable<PendingTerminalCreate>;
    terminals: Map<string, { cwd: string; exited: Promise<void> }>;
    /** 结束终端：发出 kill，并把它登记到 exiting 直到退出。 */
    cleanupTerminal: (id: string) => void;
    exiting: ExitingTerminals;
    blocks: TerminalPathBlocks;
    /** 仅供单测缩短等待。 */
    exitWaitMs?: number;
  },
): Promise<void> {
  const rawTarget = resolve(path);
  const block = state.blocks.get(rawTarget) ?? { count: 0, real: null, identity: null };
  block.count += 1;
  state.blocks.set(rawTarget, block);
  // 先同步标记仍在创建中的终端，再等待 realpath，避免在此期间漏掉新开始的创建。
  const waits: Promise<void>[] = [];
  const cancelled: PendingTerminalCreate[] = [];
  const cancelPendingUnder = (target: string) => {
    for (const pending of state.pendingCreates) {
      if (!pending.cancelled && isPathSameOrInside(pending.cwd, target)) {
        pending.cancelled = true;
        cancelled.push(pending);
        waits.push(pending.settled);
      }
    }
  };
  cancelPendingUnder(rawTarget);
  const target = await realpath(path).catch(() => rawTarget);
  block.real = target;
  block.identity ??= await readPathIdentity(target);
  cancelPendingUnder(target);
  for (const terminal of state.exiting.values()) {
    if (!isPathSameOrInside(terminal.cwd, target)) continue;
    terminal.kill();
    waits.push(terminal.exited);
  }
  for (const [id, terminal] of Array.from(state.terminals.entries())) {
    if (!isPathSameOrInside(terminal.cwd, target)) continue;
    state.cleanupTerminal(id);
    waits.push(terminal.exited);
  }
  const allExited =
    waits.length === 0 || (await waitForExitBounded(Promise.all(waits), state.exitWaitMs));
  if (!allExited || cancelled.some((pending) => pending.exitTimedOut)) {
    throw new Error(TERMINALS_DID_NOT_EXIT);
  }
}
