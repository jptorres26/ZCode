import { useEffect, useRef, useState } from "react";
import type { GitCreateWorktreeResult } from "@zcode/shared";
import { Checkbox } from "@/components/ui/checkbox.js";
import { GitBranchCreateDialog } from "@/git-branch-switcher/GitBranchDialogs.js";
import { useGitWorktreeCreate } from "@/hooks/useGitWorktreeCreate.js";
import {
  useWorktreeSetupConfig,
  type WorktreeSetupConfigState,
} from "@/hooks/useWorktreeSetupConfig.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingWorkspaceSetup } from "@/terminal/pendingTerminalCommands.js";

/** “在新 worktree 中开始”对话框：输入新分支名，成功后交给宿主打开新 workspace。 */
export function GitWorktreeCreateDialog({
  open,
  workspacePath,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  workspacePath: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: Extract<GitCreateWorktreeResult, { ok: true }>) => void;
}) {
  const { intl } = useZCodeIntl();
  const [branchName, setBranchName] = useState("");
  const [runSetup, setRunSetup] = useState(true);
  const { pending, create } = useGitWorktreeCreate(workspacePath);
  const setup = useWorktreeSetupConfig(workspacePath, open);
  // 修复原因：创建中（最长数分钟）用 Esc 关闭对话框或切走后，完成回调仍会转移草稿并切换 workspace。
  // 修复依据：创建中不允许关闭；组件卸载后忽略结果。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const close = () => {
    onOpenChange(false);
    setBranchName("");
    setRunSetup(true);
  };
  const setupCommand = setup.status === "ready" ? setup.config.command : null;

  return (
    <GitBranchCreateDialog
      mode="worktree"
      open={open}
      branchName={branchName}
      mutationPending={pending}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else if (!pending) close();
      }}
      onBranchNameChange={setBranchName}
      onCancel={close}
      onSubmit={() => {
        // 提交时的命令即对话框展示的命令；读取尚未完成时不运行。
        const command = runSetup ? setupCommand : null;
        void create(branchName.trim()).then((result) => {
          if (!result || !mountedRef.current) return;
          if (command) {
            // 必须在宿主切换 workspace 之前登记，useAppPanels 在新 workspace key 生效后取出。
            // 本地 worktree 没有 workspaceIdentity，身份 key 即其路径。
            setPendingWorkspaceSetup(result.workspacePath, {
              name: intl.formatMessage({ id: "git.worktree.setup.terminalTitle" }),
              command,
            });
          }
          close();
          onCreated(result);
        });
      }}
    >
      <WorktreeSetupOption
        setup={setup}
        checked={runSetup}
        disabled={pending}
        onCheckedChange={setRunSetup}
      />
    </GitBranchCreateDialog>
  );
}

/** setup 命令选项：完整展示将要执行的命令；未配置时不渲染。规范：docs/specs/git-worktree-task.md */
function WorktreeSetupOption({
  setup,
  checked,
  disabled,
  onCheckedChange,
}: {
  setup: WorktreeSetupConfigState;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  if (setup.status === "loading") {
    return null;
  }
  const problemId =
    setup.status === "unreadable"
      ? "git.worktree.setup.unreadable"
      : setup.config.error === "too-large"
        ? "git.worktree.setup.tooLarge"
        : setup.config.error
          ? "git.worktree.setup.invalid"
          : null;
  if (problemId) {
    return (
      <p className="text-ui-base text-foreground-subtle" data-worktree-setup-problem>
        {intl.formatMessage({ id: problemId })}
      </p>
    );
  }
  if (setup.status !== "ready" || !setup.config.command) {
    return null;
  }
  return (
    <div className="space-y-2" data-worktree-setup>
      <label className="flex items-center gap-2 text-ui-base font-medium text-foreground">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        {intl.formatMessage({ id: "git.worktree.setup.label" })}
      </label>
      {/* 完整展示将要执行的命令，不截断，避免仓库配置在长空白后藏入其它命令。 */}
      <pre className="max-h-40 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground">
        {setup.config.command}
      </pre>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "git.worktree.setup.hint" })}
      </p>
    </div>
  );
}
