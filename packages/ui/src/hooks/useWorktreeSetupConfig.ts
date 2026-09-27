import { parseWorktreeSetupConfig, type WorktreeSetupConfig } from "@zcode/shared";
import { useEffect, useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { getErrorKindForLog } from "@/lib/errorMessage.js";
import { readWorkspaceConfigFile } from "@/lib/workspaceConfigFile.js";
import { logger } from "@/logger.js";

export type WorktreeSetupConfigState =
  | { status: "loading" }
  | { status: "ready"; config: WorktreeSetupConfig }
  | { status: "unreadable" };

/**
 * worktree 对话框每次打开时读取一次源 workspace 的 `worktree.setup`（仅本地 workspace）。
 * 规范：docs/specs/git-worktree-task.md
 */
export function useWorktreeSetupConfig(
  workspacePath: string,
  open: boolean,
): WorktreeSetupConfigState {
  const { fileService } = useServices();
  const [state, setState] = useState<WorktreeSetupConfigState>({ status: "loading" });

  useEffect(() => {
    if (!open) {
      return;
    }
    let disposed = false;
    setState({ status: "loading" });
    void readWorkspaceConfigFile(fileService, workspacePath)
      .then((file) => {
        if (disposed) return;
        setState({
          status: "ready",
          config:
            file.status === "too-large"
              ? { command: null, error: "too-large" }
              : parseWorktreeSetupConfig(file.content),
        });
      })
      .catch((error: unknown) => {
        logger.warn("[GitWorktree] 读取 .zcode/config.json 失败", {
          errorKind: getErrorKindForLog(error),
        });
        if (!disposed) setState({ status: "unreadable" });
      });
    return () => {
      disposed = true;
    };
  }, [fileService, open, workspacePath]);

  return state;
}
