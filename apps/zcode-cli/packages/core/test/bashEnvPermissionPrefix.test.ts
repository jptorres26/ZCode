import assert from "node:assert/strict";
import test from "node:test";
import { resolveBashPermissionRulePolicy } from "../src/tool/handlers/bash-command-permission-policy.js";

const SAVED_RULE = [{ ruleContent: "env git status:*", toolName: "Bash" }];

function allowedBySavedRule(command: string): boolean {
  const policy = resolveBashPermissionRulePolicy({ command });
  assert.ok(policy, command);
  return policy.evaluateRules("allow", SAVED_RULE);
}

test("a saved env prefix rule still matches ordinary env invocations", () => {
  for (const command of [
    "env git status",
    "env -i git status --short",
    "env -u FOO git status",
    "env -uFOO git status",
    "env --unset=FOO git status",
    "env -- git status",
  ]) {
    assert.equal(allowedBySavedRule(command), true, command);
  }
});

test("env -S in any spelling never matches a saved prefix rule", () => {
  for (const command of [
    "env -S 'sh -c id' git status",
    "env '-Ssh -c id' git status",
    "env '-vSsh -c id' git status",
    "env -iS 'sh -c id' git status",
    "env --split-string='sh -c id' git status",
    "env --split-string 'sh -c id' git status",
    "env --split='sh -c id' git status",
    "env --sp='sh -c id' git status",
  ]) {
    assert.equal(allowedBySavedRule(command), false, command);
  }
});

test("unknown or ambiguous env options fall back to exact rules", () => {
  for (const command of ["env --frobnicate git status", "env -Z git status"]) {
    assert.equal(allowedBySavedRule(command), false, command);
    const policy = resolveBashPermissionRulePolicy({ command });
    assert.deepEqual(policy?.suggestedPermissionUpdates, [
      {
        behavior: "allow",
        rules: [{ ruleContent: command, toolName: "Bash" }],
        type: "addRules",
      },
    ]);
  }
});
