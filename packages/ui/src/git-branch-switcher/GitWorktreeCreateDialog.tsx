import { useState } from "react";
import type { GitCreateWorktreeResult } from "@zcode/shared";
import { GitBranchCreateDialog } from "@/git-branch-switcher/GitBranchDialogs.js";
import { useGitWorktreeCreate } from "@/hooks/useGitWorktreeCreate.js";

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
  const [branchName, setBranchName] = useState("");
  const { pending, create } = useGitWorktreeCreate(workspacePath);
  const close = () => {
    onOpenChange(false);
    setBranchName("");
  };

  return (
    <GitBranchCreateDialog
      mode="worktree"
      open={open}
      branchName={branchName}
      mutationPending={pending}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else close();
      }}
      onBranchNameChange={setBranchName}
      onCancel={close}
      onSubmit={() => {
        void create(branchName.trim()).then((result) => {
          if (!result) return;
          close();
          onCreated(result);
        });
      }}
    />
  );
}
