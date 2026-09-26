import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrInsidePath } from "../src/lib/path.js";

test("workspace paths inside a worktree are matched, siblings sharing a prefix are not", () => {
  assert.equal(isSameOrInsidePath("/wt/repo-1/feat", "/wt/repo-1/feat"), true);
  assert.equal(isSameOrInsidePath("/wt/repo-1/feat/packages/app", "/wt/repo-1/feat/"), true);
  assert.equal(isSameOrInsidePath("/wt/repo-1/feat-2", "/wt/repo-1/feat"), false);
  assert.equal(isSameOrInsidePath("/wt/repo-1", "/wt/repo-1/feat"), false);
  assert.equal(isSameOrInsidePath("C:\\WT\\Repo\\Feat\\src", "c:/wt/repo/feat"), true);
  assert.equal(isSameOrInsidePath("C:\\WT\\Repo\\Feat-2", "c:\\wt\\repo\\feat"), false);
});
