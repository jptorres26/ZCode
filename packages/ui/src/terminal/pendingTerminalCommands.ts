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
