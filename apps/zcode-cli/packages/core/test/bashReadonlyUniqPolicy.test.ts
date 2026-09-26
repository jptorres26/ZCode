import assert from "node:assert/strict";
import test from "node:test";
import { isRuntimeReadOnlyBashCommand } from "../src/tool/handlers/bash-semantics.js";

test("uniq reading a file or stdin stays auto-approved", () => {
  for (const command of [
    "uniq in.txt",
    "uniq -c in.txt",
    "uniq -f 1 in.txt",
    "uniq --skip-fields=2 -i in.txt",
    "uniq --all-repeated=separate in.txt",
    "sort in.txt | uniq -c",
    "uniq -",
  ]) {
    assert.equal(isRuntimeReadOnlyBashCommand(command), true, command);
  }
});

test("uniq with an output operand is not auto-approved", () => {
  // GNU uniq 的第二个操作数是输出文件，会被创建或覆盖。
  for (const command of [
    "uniq in.txt out.txt",
    "uniq -c in.txt out.txt",
    "uniq -f 1 in.txt out.txt",
    "uniq -- in.txt out.txt",
    "uniq - out.txt",
    "uniq --frobnicate in.txt",
  ]) {
    assert.equal(isRuntimeReadOnlyBashCommand(command), false, command);
  }
});
