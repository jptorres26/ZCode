import { useEffect, useRef, useState } from "react";
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
  };

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
        void create(branchName.trim()).then((result) => {
          if (!result || !mountedRef.current) return;
          close();
          onCreated(result);
        });
      }}
    />
  );
}
