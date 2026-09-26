import assert from "node:assert/strict";
import test from "node:test";
import { isRuntimeReadOnlyBashCommand } from "../src/tool/handlers/bash-semantics.js";
import {
  isSedInPlaceOption,
  sedScriptMayWriteOrExecute,
} from "../src/tool/handlers/bash-readonly-policy-sed.js";

// 这些命令在 GNU sed 4.9 下都会写文件或执行命令，只读策略不能自动放行。
const WRITE_OR_EXEC_COMMANDS = [
  "sed 'w out' in",
  "sed 'wout' in",
  "sed 'W out' in",
  "sed 'e touch pwn' in",
  "sed 'etouch pwn' in",
  "sed 's/a/b/w out' in",
  "sed 's/a/b/e' in",
  "sed 's/a/b/ w out' in",
  "sed 's/a/b/g w out' in",
  "sed 's/a/b/gw out' in",
  "sed '/a/Iw out' in",
  "sed '/a/I e touch pwn' in",
  "sed '\\,a, w out' in",
  "sed '1 !w out' in",
  "sed '/a/Is/a/b/w out' in",
  "sed 's a b w out' in",
  "sed 's;a;touch pwn;ge' in",
  "sed 's}a}b}gw out' in",
  "sed 's/[/]/x/w out' in",
  "sed 's/[\\]/x/w out' in",
  "sed -n 's/a/b/;w out' in",
  "sed -e '/x/{p;w out' -e '}' in",
  "sed -e's/a/b/w out' in",
  "sed '-ew out' in",
  "sed -ne 'w out' in",
  "sed -nes/a/b/w\\ out in",
  "sed --expression='w out' in",
  "sed -e p -e 'w out' in",
  "sed -ni 's/a/b/' f",
  "sed -f script.sed in",
  "sed 's/a/b/;wq' in",
  "sed '$!N;w out' in",
];

const READ_ONLY_COMMANDS = [
  "sed -n '1,20p' file.txt",
  "sed -n '/start/,/end/p' file.txt",
  "sed 's/a/b/g' file.txt",
  "sed -E 's#(foo)+#\\1#g' file.txt",
  "sed '1d' file.txt",
  "sed -n '$p' file.txt",
  "sed '/^$/d' file.txt",
  "sed 's/\\(a\\)/\\1/' file.txt",
  "sed -n 'l' file.txt",
  "sed '5q' file.txt",
  "sed = file.txt",
  "sed '1~2d' file.txt",
  "sed 'y/abc/xyz/' file.txt",
  "sed -n '/x/{p;d}' file.txt",
  "sed -e 's/a/b/' -e 's/c/d/' file.txt",
  "sed '0,/re/d' file.txt",
  "sed -n '/re/I p' file.txt",
  "sed 's/[/]/x/g' file.txt",
  "sed -n '/a/ , /c/ p' file.txt",
  "sed ':a;N;$!ba;s/\\n/ /g' file.txt",
];

test("sed scripts that write files or run commands are not auto-approved", () => {
  for (const command of WRITE_OR_EXEC_COMMANDS) {
    assert.equal(isRuntimeReadOnlyBashCommand(command), false, command);
  }
});

test("ordinary read-only sed scripts stay auto-approved", () => {
  for (const command of READ_ONLY_COMMANDS) {
    assert.equal(isRuntimeReadOnlyBashCommand(command), true, command);
  }
});

test("scripts that cannot be fully parsed fail closed", () => {
  for (const script of ["s/a/b", "s/a/b/q", "y/ab/c", "/unterminated", "k", "s/a/b/\\"]) {
    assert.equal(sedScriptMayWriteOrExecute(script), true, script);
  }
  assert.equal(sedScriptMayWriteOrExecute("r other.txt"), false);
  assert.equal(sedScriptMayWriteOrExecute("a\\\nw is text here"), false);
  assert.equal(sedScriptMayWriteOrExecute("# w comment\np"), false);
});

test("backslash-heavy scripts are scanned in linear time", () => {
  const started = performance.now();
  for (const count of [40, 44, 2000]) {
    isRuntimeReadOnlyBashCommand(`sed '/${"\\".repeat(count)}x' in`);
    sedScriptMayWriteOrExecute(`s/${"\\".repeat(count)}/x/`);
  }
  assert.ok(performance.now() - started < 1000, "sed policy check took too long");
});

test("in-place detection covers clustered and abbreviated options", () => {
  for (const word of ["-i", "-i.bak", "-ni", "-Ei", "--in-place", "--in-place=.bak", "--in"]) {
    assert.equal(isSedInPlaceOption(word), true, word);
  }
  for (const word of ["-n", "-e", "-nes/i/x/", "-E", "--expression", "file"]) {
    assert.equal(isSedInPlaceOption(word), false, word);
  }
});
