/**
 * `<workspace>/.zcode/config.json` 中 UI 使用的字段解析（纯函数）：
 * 顶层 `actions`（规范：docs/specs/project-actions.md）与 `worktree.setup`（规范：docs/specs/git-worktree-task.md）。
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
// 修复原因（续）：Unicode 双向控制符（U+202A–U+202E、U+2066–U+2069）会让浏览器按与实际字节不同的顺序显示命令，
// 零宽等格式字符、韩文填充符等默认不可见字符与行/段分隔符同样不可见；大段连续空白在自动换行后会把后续命令
// 挤出可视区域。修复依据：命令拒绝 Cc（含 C1）、Cf、Zl、Zp、Default_Ignorable_Code_Point、盲文空白 U+2800，
// 以及超过 16 个的连续空白。
// 变体选择符 U+FE00–U+FE0F 只在紧跟表情符号（如 ⚠️）或组成键帽（1️⃣）时保留：跟在空格或字母后它不可见，
// 既能打断空白折叠制造成片空行，也能让 `build\uFE0F.sh` 显示成 `build.sh` 却执行另一个文件。
const HIDDEN_IN_COMMAND =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u2800]|(?<!\p{Extended_Pictographic})[\uFE00-\uFE0F](?!\u20E3)|(?![\uFE00-\uFE0F])\p{Default_Ignorable_Code_Point}|\s{17,}/u;
// 名称只用于显示：保留 ZWJ 表情与 LRM/RLM 等正常排版字符，只拒绝控制字符、行/段分隔符与会重排显示顺序的
// 双向嵌入/覆盖/隔离符。
const HIDDEN_IN_NAME = /[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u;

const commandSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((value) => !HIDDEN_IN_COMMAND.test(value));

const projectActionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !HIDDEN_IN_NAME.test(value)),
  command: commandSchema,
});

const projectActionsSchema = z.array(projectActionSchema).max(PROJECT_ACTIONS_MAX_COUNT);

/** 解析顶层 JSON 对象；空内容为 null，非对象为 "invalid-json"。 */
function parseConfigObject(
  content: string | null,
): Record<string, unknown> | null | "invalid-json" {
  if (content === null || content.trim() === "") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return "invalid-json";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "invalid-json";
  }
  return value as Record<string, unknown>;
}

/** 文件内容为 null 表示文件不存在；其余字段（hooks、plugins 等）一律忽略。 */
export function parseProjectActionsConfig(content: string | null): ProjectActionsConfig {
  const config = parseConfigObject(content);
  if (config === "invalid-json") {
    return { actions: [], error: "invalid-json" };
  }
  const rawActions = config?.actions;
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

export type WorktreeSetupConfigError = "invalid-json" | "invalid-setup" | "too-large";

export interface WorktreeSetupConfig {
  /** 未配置时为 null。 */
  command: string | null;
  error?: WorktreeSetupConfigError;
}

/** 新建 worktree 后的 setup 命令：`worktree.setup`，规则与项目操作的 command 相同。 */
export function parseWorktreeSetupConfig(content: string | null): WorktreeSetupConfig {
  const config = parseConfigObject(content);
  if (config === "invalid-json") {
    return { command: null, error: "invalid-json" };
  }
  const worktree = config?.worktree;
  if (worktree === undefined) {
    return { command: null };
  }
  if (typeof worktree !== "object" || worktree === null || Array.isArray(worktree)) {
    return { command: null, error: "invalid-setup" };
  }
  const rawSetup = (worktree as { setup?: unknown }).setup;
  if (rawSetup === undefined) {
    return { command: null };
  }
  const parsed = commandSchema.safeParse(rawSetup);
  return parsed.success ? { command: parsed.data } : { command: null, error: "invalid-setup" };
}
