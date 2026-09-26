/**
 * Review 面板 diff 行评论的纯函数。规范：docs/specs/git-review-pane-diff-comments.md
 */
import type { CodeCommentSide } from "@/lib/codeCommentContext.js";

export type DiffCommentSide = "additions" | "deletions";

export interface DiffCommentRange {
  side: DiffCommentSide;
  startLine: number;
  endLine: number;
}

/** @pierre/diffs 的选区：行号为该侧文件的真实行号。 */
export interface DiffLineSelection {
  start: number;
  end: number;
  side?: DiffCommentSide;
  endSide?: DiffCommentSide;
}

/**
 * 同侧选区取升序范围；跨侧选区（统一视图同时选中删除行与新增行，或并排视图跨栏）两侧行号不可比，
 * 只保留结束行所在侧的结束行。
 */
export function normalizeDiffCommentRange(selection: DiffLineSelection): DiffCommentRange | null {
  if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end)) {
    return null;
  }
  const endSide = selection.endSide ?? selection.side ?? "additions";
  const startSide = selection.side ?? endSide;
  if (startSide !== endSide) {
    return { side: endSide, startLine: selection.end, endLine: selection.end };
  }
  return {
    side: endSide,
    startLine: Math.min(selection.start, selection.end),
    endLine: Math.max(selection.start, selection.end),
  };
}

export function toCodeCommentSide(side: DiffCommentSide): CodeCommentSide {
  return side === "deletions" ? "L" : "R";
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 从 unified patch 的 hunk 中按侧重建“行号 → 文本”。 */
export function getPatchSideLines(patch: string, side: DiffCommentSide): Map<number, string> {
  const lines = new Map<number, string>();
  const rawLines = patch.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  rawLines.forEach((rawLine, index) => {
    const header = HUNK_HEADER_PATTERN.exec(rawLine);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      return;
    }
    if (!inHunk || rawLine.startsWith("\\")) {
      return;
    }
    // 部分工具会去掉空上下文行的前导空格；patch 末尾的换行产生的空串不算内容行。
    const marker = rawLine === "" ? (index === rawLines.length - 1 ? null : " ") : rawLine[0];
    const text = rawLine.slice(1);
    if (marker === " ") {
      lines.set(side === "deletions" ? oldLine : newLine, text);
      oldLine += 1;
      newLine += 1;
    } else if (marker === "-") {
      if (side === "deletions") lines.set(oldLine, text);
      oldLine += 1;
    } else if (marker === "+") {
      if (side === "additions") lines.set(newLine, text);
      newLine += 1;
    } else {
      inHunk = false;
    }
  });
  return lines;
}

/** 评论引用的代码：优先用该侧完整内容，只有 patch 时从 hunk 取。 */
export function getDiffCommentSelectedText(
  source: { contents?: string | null; patch?: string | null },
  range: DiffCommentRange,
): string {
  if (typeof source.contents === "string") {
    return source.contents
      .split("\n")
      .slice(range.startLine - 1, range.endLine)
      .join("\n");
  }
  if (!source.patch) {
    return "";
  }
  const sideLines = getPatchSideLines(source.patch, range.side);
  const selected: string[] = [];
  for (let line = range.startLine; line <= range.endLine; line += 1) {
    const text = sideLines.get(line);
    if (text !== undefined) selected.push(text);
  }
  return selected.join("\n");
}
