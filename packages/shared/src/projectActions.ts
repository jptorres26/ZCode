/**
 * 项目操作：`<workspace>/.zcode/config.json` 顶层 `actions` 的解析（纯函数）。
 * 规范：docs/specs/project-actions.md
 */
import { z } from "zod";

export const PROJECT_ACTIONS_MAX_COUNT = 50;

export interface ProjectAction {
  /** 列表内稳定 key：序号 + 名称。 */
  id: string;
  name: string;
  command: string;
}

export type ProjectActionsConfigError = "invalid-json" | "invalid-actions" | "too-large";

export interface ProjectActionsConfig {
  actions: ProjectAction[];
  error?: ProjectActionsConfigError;
}

// 修复原因：命令中的换行会让写入终端的一次输入变成多条命令，其它控制字符也会让菜单显示与实际执行不一致，
// 仓库里的配置可借此隐藏后续命令。修复依据：名称与命令都拒绝 C0 控制字符与 DEL，菜单完整展示的就是将执行的内容。
function hasNoControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

const projectActionSchema = z.object({
  name: z.string().trim().min(1).max(80).refine(hasNoControlCharacters),
  command: z.string().trim().min(1).max(4000).refine(hasNoControlCharacters),
});

const projectActionsSchema = z.array(projectActionSchema).max(PROJECT_ACTIONS_MAX_COUNT);

/** 文件内容为 null 表示文件不存在；其余字段（hooks、plugins 等）一律忽略。 */
export function parseProjectActionsConfig(content: string | null): ProjectActionsConfig {
  if (content === null || content.trim() === "") {
    return { actions: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { actions: [], error: "invalid-json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { actions: [], error: "invalid-json" };
  }
  const rawActions = (value as { actions?: unknown }).actions;
  if (rawActions === undefined) {
    return { actions: [] };
  }
  const parsed = projectActionsSchema.safeParse(rawActions);
  if (!parsed.success) {
    return { actions: [], error: "invalid-actions" };
  }
  return {
    actions: parsed.data.map((action, index) => ({
      id: `${index}:${action.name}`,
      name: action.name,
      command: action.command,
    })),
  };
}
