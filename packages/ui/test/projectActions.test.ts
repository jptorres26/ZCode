import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_ACTIONS_MAX_COUNT, parseProjectActionsConfig } from "@zcode/shared";
import { isMissingFileError } from "../src/lib/missingFileError.js";
import {
  setPendingTerminalCommand,
  takePendingTerminalCommand,
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
