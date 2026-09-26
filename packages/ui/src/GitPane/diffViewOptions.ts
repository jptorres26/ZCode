/**
 * Review 面板 diff 视图选项的纯函数。规范：docs/specs/git-review-pane-diff-view-options.md
 */
import type { ReviewDiffStyle } from "@/lib/codePreviewSettings.js";

/** 小于该宽度时并排两栏过窄，强制统一视图（含手机 Web 侧栏）。 */
export const REVIEW_SPLIT_DIFF_MIN_WIDTH_PX = 640;

/** 保存的偏好不变，只决定当前实际渲染的布局。 */
export function resolveReviewDiffStyle(
  preference: ReviewDiffStyle,
  canSplit: boolean,
): ReviewDiffStyle {
  return preference === "split" && canSplit ? "split" : "unified";
}

/** 面板内的换行覆盖优先于全局“长行自动换行”设置。 */
export function resolveReviewWrapLongLines(override: boolean | null, globalWrap: boolean): boolean {
  return override ?? globalWrap;
}
