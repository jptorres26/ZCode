import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { quoteDesktopEntryExecArg } from "../src/main/desktopEntryExec.js";

test("Exec arguments use both the quoting and the string escaping layer", () => {
  assert.equal(quoteDesktopEntryExecArg("/opt/ZCode.AppImage"), '"/opt/ZCode.AppImage"');
  assert.equal(quoteDesktopEntryExecArg("/a b/100%"), '"/a b/100%%"');
  assert.equal(quoteDesktopEntryExecArg("a$b"), '"a\\\\$b"');
  assert.equal(quoteDesktopEntryExecArg("c\\d"), '"c\\\\\\\\d"');
  assert.equal(quoteDesktopEntryExecArg('e"f'), '"e\\\\"f"');
  assert.equal(quoteDesktopEntryExecArg("g`h"), '"g\\\\`h"');
});

function hasGio(): boolean {
  if (process.platform !== "linux") return false;
  try {
    execFileSync("gio", ["help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("GLib parses the quoted Exec line back into the original arguments", async (t) => {
  if (!hasGio()) {
    t.skip("gio is not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "zcode-desktop-exec-"));
  try {
    const script = join(dir, "argv.sh");
    const output = join(dir, "argv.txt");
    await writeFile(
      script,
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${output}"\n`,
    );
    await chmod(script, 0o755);
    const args = ["a$b", "c\\d", 'e"f', "g`h", "100%", "sp ace"];
    const exec = [script, ...args].map(quoteDesktopEntryExecArg).join(" ");
    const desktopFile = join(dir, "t.desktop");
    await writeFile(desktopFile, `[Desktop Entry]\nType=Application\nName=T\nExec=${exec} %U\n`);
    execFileSync("gio", ["launch", desktopFile], { stdio: "ignore" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const lines = await readFile(output, "utf8").catch(() => "");
      if (lines.split("\n").filter(Boolean).length >= args.length) break;
      await sleep(100);
    }
    assert.deepEqual((await readFile(output, "utf8")).split("\n").filter(Boolean), args);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
