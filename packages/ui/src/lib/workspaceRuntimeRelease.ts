import type { IZCodeTaskService } from "@zcode/services";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { logger } from "@/logger.js";

/**
 * 释放 workspace 的 runtime；返回的 Promise 在释放结束后 resolve 为是否成功（失败只记录、不抛出）。
 * 普通移除不关心结果；删除 worktree 必须确认释放成功后才能删除目录。
 */
export function releaseWorkspaceRuntimeAfterProjectRemoval({
  tab,
  zcodeTaskService,
}: {
  tab: Pick<WorkspaceTabState, "workspacePath" | "workspaceIdentity">;
  zcodeTaskService: Pick<IZCodeTaskService, "releaseWorkspacePreparation">;
}): Promise<boolean> {
  const workspaceIdentity = tab.workspaceIdentity?.trim() || undefined;
  // 修复原因：失败被转换为正常完成后，删除 worktree 会以为 runtime 已释放，在 Agent 仍以该目录为 cwd 时删除检出。
  // 修复依据：以 true/false 返回释放结果，由删除流程在失败时中止。
  return zcodeTaskService
    .releaseWorkspacePreparation({
      workspacePath: tab.workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    })
    .then(
      () => true,
      (error: unknown) => {
        // Windows 会把 Agent/终端子进程 cwd 视为目录占用；移除项目必须主动释放 runtime。
        // 释放失败不能回滚 UI 移除，只记录 workspace key 方便定位残留进程。
        logger.error("[WorkspaceSidebarItem] 移除 workspace 后释放 runtime 失败", {
          workspaceKey: workspaceIdentity ?? tab.workspacePath,
          error,
        });
        return false;
      },
    );
}
