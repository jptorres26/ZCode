import assert from "node:assert/strict";
import test from "node:test";
import { isPathSameOrInside } from "../src/terminal/terminalDisposal.js";

test("terminals started in the folder or below it are matched, siblings are not", () => {
  assert.equal(isPathSameOrInside("/wt/repo-1/feat", "/wt/repo-1/feat", "linux"), true);
  assert.equal(
    isPathSameOrInside("/wt/repo-1/feat/packages/app", "/wt/repo-1/feat", "linux"),
    true,
  );
  assert.equal(isPathSameOrInside("/wt/repo-1/feat-2", "/wt/repo-1/feat", "linux"), false);
  assert.equal(isPathSameOrInside("/wt/repo-1", "/wt/repo-1/feat", "linux"), false);
  assert.equal(isPathSameOrInside("/home/me", "/wt/repo-1/feat", "linux"), false);
});

test("Windows paths compare case-insensitively", { skip: process.platform !== "win32" }, () => {
  assert.equal(isPathSameOrInside("C:\\WT\\Repo\\Feat\\src", "c:\\wt\\repo\\feat", "win32"), true);
  assert.equal(isPathSameOrInside("C:\\WT\\Repo\\Feat-2", "c:\\wt\\repo\\feat", "win32"), false);
});
