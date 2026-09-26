import type { IFileService } from "@zcode/services";
import { isMissingFileError } from "@/lib/missingFileError.js";
import { joinFilePath } from "@/lib/path.js";

/** 与文件服务单次读取上限一致；配置更大时明确提示，而不是截断后报 JSON 无效。 */
const WORKSPACE_CONFIG_READ_BYTES = 256 * 1024;

type WorkspaceConfigFileContent =
  | { status: "ok"; content: string | null }
  | { status: "too-large" };

/**
 * 读取 `<workspace>/.zcode/config.json`（项目操作菜单与 worktree setup 共用）；文件不存在时 content 为 null。
 * 规范：docs/specs/project-actions.md、docs/specs/git-worktree-task.md
 */
export async function readWorkspaceConfigFile(
  fileService: Pick<IFileService, "readTextFile">,
  workspacePath: string,
): Promise<WorkspaceConfigFileContent> {
  const configPath = joinFilePath(joinFilePath(workspacePath, ".zcode"), "config.json");
  // 直接读取而不走 checkFilesExist：后者为聊天路径提及做了一分钟正负结果缓存，
  // 用户刚创建或删除配置时会读到过期结论。
  const slice = await fileService
    .readTextFile({ path: configPath, length: WORKSPACE_CONFIG_READ_BYTES })
    .catch((error: unknown) => {
      if (isMissingFileError(error)) return null;
      throw error;
    });
  // 修复原因：默认只读 128KB 且忽略 truncated，合规但较大的配置会被截断后误报为无效 JSON。
  if (slice?.truncated) {
    return { status: "too-large" };
  }
  return { status: "ok", content: slice ? slice.content : null };
}
