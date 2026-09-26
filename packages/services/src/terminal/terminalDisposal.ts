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

/**
 * 结束所有初始 cwd 位于 `path` 下的终端（含仍在创建中的），并等待它们退出。
 */
export async function disposeTerminalsUnderPath(
  path: string,
  state: {
    pendingCreates: Iterable<PendingTerminalCreate>;
    terminals: Map<string, { cwd: string; exited: Promise<void> }>;
    cleanupTerminal: (id: string) => void;
  },
): Promise<void> {
  const rawTarget = resolve(path);
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
