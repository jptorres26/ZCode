/**
 * 终端标签的一次性首条输入。规范：docs/specs/project-actions.md
 *
 * 命令只存在于内存并在取出时删除，不进入可持久化的标签状态：刷新或恢复标签时不会重复执行。
 */
const pendingCommands = new Map<string, string>();

export function setPendingTerminalCommand(terminalTabId: string, command: string): void {
  pendingCommands.set(terminalTabId, command);
}

export function takePendingTerminalCommand(terminalTabId: string): string | undefined {
  const command = pendingCommands.get(terminalTabId);
  pendingCommands.delete(terminalTabId);
  return command;
}

/**
 * 新 workspace 激活后要运行的 setup 命令（按 workspace 身份 key），由 useAppPanels 在 key 变化后取出。
 * 规范：docs/specs/git-worktree-task.md
 */
const pendingWorkspaceSetup = new Map<string, { name: string; command: string }>();

export function setPendingWorkspaceSetup(
  workspaceKey: string,
  action: { name: string; command: string },
): void {
  pendingWorkspaceSetup.set(workspaceKey, action);
}

export function takePendingWorkspaceSetup(
  workspaceKey: string,
): { name: string; command: string } | undefined {
  const action = pendingWorkspaceSetup.get(workspaceKey);
  pendingWorkspaceSetup.delete(workspaceKey);
  return action;
}
