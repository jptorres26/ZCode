import assert from "node:assert/strict";
import test from "node:test";
import {
  getDiffCommentSelectedText,
  getPatchSideLines,
  normalizeDiffCommentRange,
  toCodeCommentSide,
} from "../src/GitPane/diffComments.js";
import {
  buildPromptWithCodeComments,
  parsePromptCodeComments,
  type CodeCommentComposerAttachment,
} from "../src/lib/codeCommentContext.js";

test("same-side selections become an ascending range on that side", () => {
  assert.deepEqual(normalizeDiffCommentRange({ start: 7, end: 3, side: "additions" }), {
    side: "additions",
    startLine: 3,
    endLine: 7,
  });
  assert.deepEqual(
    normalizeDiffCommentRange({ start: 2, end: 4, side: "deletions", endSide: "deletions" }),
    { side: "deletions", startLine: 2, endLine: 4 },
  );
  // 没有 side 信息时按新增侧处理
  assert.deepEqual(normalizeDiffCommentRange({ start: 5, end: 5 }), {
    side: "additions",
    startLine: 5,
    endLine: 5,
  });
});

test("cross-side selections keep only the end line on the end side", () => {
  assert.deepEqual(
    normalizeDiffCommentRange({ start: 10, end: 12, side: "deletions", endSide: "additions" }),
    { side: "additions", startLine: 12, endLine: 12 },
  );
  assert.equal(normalizeDiffCommentRange({ start: Number.NaN, end: 1 }), null);
  assert.equal(toCodeCommentSide("deletions"), "L");
  assert.equal(toCodeCommentSide("additions"), "R");
});

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -3,4 +3,5 @@ export function f() {",
  " keep3",
  "-old4",
  "--- old5 starts with dashes",
  "+new4",
  "+new5",
  "+new6",
  "",
  "\\ No newline at end of file",
  "@@ -20,2 +21,2 @@",
  " keep20",
  "-old21",
  "+new22",
  "",
].join("\n");

test("patch hunks rebuild line numbers per side", () => {
  assert.deepEqual(
    [...getPatchSideLines(PATCH, "deletions")],
    [
      [3, "keep3"],
      [4, "old4"],
      [5, "-- old5 starts with dashes"],
      [6, ""],
      [20, "keep20"],
      [21, "old21"],
    ],
  );
  assert.deepEqual(
    [...getPatchSideLines(PATCH, "additions")],
    [
      [3, "keep3"],
      [4, "new4"],
      [5, "new5"],
      [6, "new6"],
      [7, ""],
      [21, "keep20"],
      [22, "new22"],
    ],
  );
});

test("selected text prefers full contents and falls back to the patch", () => {
  const contents = "l1\nl2\nl3\nl4";
  assert.equal(
    getDiffCommentSelectedText(
      { contents, patch: PATCH },
      { side: "additions", startLine: 2, endLine: 3 },
    ),
    "l2\nl3",
  );
  assert.equal(
    getDiffCommentSelectedText(
      { contents: null, patch: PATCH },
      { side: "additions", startLine: 4, endLine: 6 },
    ),
    "new4\nnew5\nnew6",
  );
  assert.equal(
    getDiffCommentSelectedText(
      { contents: null, patch: PATCH },
      { side: "deletions", startLine: 21, endLine: 21 },
    ),
    "old21",
  );
  assert.equal(
    getDiffCommentSelectedText(
      { contents: null, patch: null },
      { side: "additions", startLine: 1, endLine: 1 },
    ),
    "",
  );
});

test("the comment side survives serializing into the prompt and parsing it back", () => {
  const base = {
    workspacePath: "/ws",
    sourcePath: "/ws/src/a.ts",
    sourceTitle: "a.ts",
    selectedText: "old4",
    comment: "why was this removed?",
  };
  const attachments: CodeCommentComposerAttachment[] = [
    { ...base, id: "c1", side: "L", startLine: 4, endLine: 4 },
    { ...base, id: "c2", startLine: 5, endLine: 6, selectedText: "new5\nnew6", comment: "ok" },
  ];
  const prompt = buildPromptWithCodeComments("please check", attachments);
  assert.match(prompt, /File: \/ws\/src\/a\.ts\nSide: L\nLines: 4\n/);
  assert.match(prompt, /File: \/ws\/src\/a\.ts\nSide: R\nLines: 5-6\n/);
  const parsed = parsePromptCodeComments(prompt, { workspacePath: "/ws" });
  assert.equal(parsed.visibleContent, "please check");
  assert.deepEqual(
    parsed.codeCommentAttachments.map((item) => [item.side ?? "R", item.startLine, item.endLine]),
    [
      ["L", 4, 4],
      ["R", 5, 6],
    ],
  );
});

test("change paths follow the workspace's path separator", async () => {
  const { resolveGitChangeAbsolutePath } = await import("../src/GitPane/helpers.js");
  assert.equal(
    resolveGitChangeAbsolutePath("C:\\Users\\me\\repo", "src/app/a.ts"),
    "C:\\Users\\me\\repo\\src\\app\\a.ts",
  );
  assert.equal(resolveGitChangeAbsolutePath("/home/me/repo", "src/a.ts"), "/home/me/repo/src/a.ts");
  assert.equal(resolveGitChangeAbsolutePath("/home/me/repo", "/abs/b.ts"), "/abs/b.ts");
});
