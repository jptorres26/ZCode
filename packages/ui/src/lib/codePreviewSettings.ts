/**
 * 代码预览设置的类型与默认值。
 *
 * 独立的中立模块：若定义在 zustand store（@/store/index.ts）里，
 * 纯展示组件（ai-elements / ToolCallBlocks）为了拿类型和默认值就要依赖 store。
 * store 只做 re-export，展示组件改为 props 传入 + 本模块默认值兜底。
 */
import type { BundledTheme } from "shiki";

/** Review 面板 diff 布局。规范：docs/specs/git-review-pane-diff-view-options.md */
export type ReviewDiffStyle = "unified" | "split";

export interface CodePreviewSettings {
  lightTheme: BundledTheme;
  darkTheme: BundledTheme;
  showLineNumbers: boolean;
  wrapLongLines: boolean;
  fontSizePx: number;
  reviewDiffStyle: ReviewDiffStyle;
}

export const DEFAULT_CODE_PREVIEW_SETTINGS: CodePreviewSettings = {
  lightTheme: "github-light",
  darkTheme: "github-dark",
  showLineNumbers: true,
  wrapLongLines: false,
  fontSizePx: 12,
  reviewDiffStyle: "unified",
};

/** localStorage 中的值可能被旧版本或手工修改污染，非法值回退为统一视图。 */
export function normalizeReviewDiffStyle(value: unknown): ReviewDiffStyle {
  return value === "split" ? "split" : "unified";
}
