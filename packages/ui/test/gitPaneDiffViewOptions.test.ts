import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveReviewDiffStyle,
  resolveReviewWrapLongLines,
} from "../src/GitPane/diffViewOptions.js";
import { normalizeReviewDiffStyle } from "../src/lib/codePreviewSettings.js";

test("a stored diff layout that is not unified or split falls back to unified", () => {
  assert.equal(normalizeReviewDiffStyle("split"), "split");
  assert.equal(normalizeReviewDiffStyle("unified"), "unified");
  for (const value of [undefined, null, "", "Split", "side-by-side", 1, {}]) {
    assert.equal(normalizeReviewDiffStyle(value), "unified", String(value));
  }
});

test("split is only rendered while the pane is wide enough, without changing the preference", () => {
  assert.equal(resolveReviewDiffStyle("split", true), "split");
  assert.equal(resolveReviewDiffStyle("split", false), "unified");
  assert.equal(resolveReviewDiffStyle("unified", true), "unified");
  assert.equal(resolveReviewDiffStyle("unified", false), "unified");
});

test("the pane's wrap override wins over the global wrap setting", () => {
  assert.equal(resolveReviewWrapLongLines(null, false), false);
  assert.equal(resolveReviewWrapLongLines(null, true), true);
  assert.equal(resolveReviewWrapLongLines(true, false), true);
  assert.equal(resolveReviewWrapLongLines(false, true), false);
});
