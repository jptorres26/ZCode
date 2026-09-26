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

export type ProjectActionsConfigError = "invalid-json" | "invalid-actions";

export interface ProjectActionsConfig {
  actions: ProjectAction[];
  error?: ProjectActionsConfigError;
}

const projectActionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  command: z.string().trim().min(1).max(4000),
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
