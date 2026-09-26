import assert from "node:assert/strict";
import test from "node:test";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

// 两份语言包都是 Record<string, string>，类型系统无法发现缺 key；
// 之前 en-US 多出的 key 就是这样漏进仓库的，这里在测试中保证两者同步。

function placeholderNames(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((match) => match[1]!).sort();
}

test("en-US and zh-CN define the same message keys", () => {
  const enKeys = new Set(Object.keys(enUS));
  const zhKeys = new Set(Object.keys(zhCN));
  assert.deepEqual(
    [...enKeys].filter((key) => !zhKeys.has(key)),
    [],
    "keys missing from zh-CN",
  );
  assert.deepEqual(
    [...zhKeys].filter((key) => !enKeys.has(key)),
    [],
    "keys missing from en-US",
  );
});

test("en-US and zh-CN use the same placeholders for each message", () => {
  const mismatches = Object.keys(enUS)
    .filter((key) => key in zhCN)
    .filter(
      (key) => placeholderNames(enUS[key]!).join(",") !== placeholderNames(zhCN[key]!).join(","),
    );
  assert.deepEqual(mismatches, []);
});
