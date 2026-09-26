import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultShortcutBindings, SHORTCUT_COMMANDS } from "@zcode/shared";
import { checkShortcutBindingConflict } from "../src/shortcuts/conflicts.js";

// conflicts.ts 要求“命令表默认绑定不得与保留键相交”，这里对两类平台逐条断言，
// 新增默认快捷键时同时拦住与保留键或其它命令的冲突。规范：docs/specs/review-pane-shortcut.md
const PLATFORMS = [
  { name: "apple", platformInfo: { platform: "MacIntel", userAgent: "Macintosh" } },
  { name: "non-apple", platformInfo: { platform: "Linux x86_64", userAgent: "X11; Linux" } },
];

test("no default binding conflicts with a reserved key or another command", () => {
  const conflicts: string[] = [];
  for (const { name, platformInfo } of PLATFORMS) {
    for (const entry of SHORTCUT_COMMANDS) {
      for (const binding of entry.defaultBindings) {
        const conflict = checkShortcutBindingConflict(entry.id, binding, undefined, {
          platformInfo,
        });
        if (conflict) {
          conflicts.push(`${name} ${entry.id} ${binding}: ${JSON.stringify(conflict)}`);
        }
      }
    }
  }
  assert.deepEqual(conflicts, []);
});

test("the Review pane toggle defaults to CmdOrCtrl+Shift+g", () => {
  assert.deepEqual(getDefaultShortcutBindings("toggleReviewPane"), ["CmdOrCtrl+Shift+g"]);
});
