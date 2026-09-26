import assert from "node:assert/strict";
import test from "node:test";
import { matchDockerContainer } from "../src/remote/dockerContainerMatch.js";

const container = (id: string, name: string) => ({
  id,
  name,
  image: "example/image",
  state: "running",
  status: "Up",
});

// 与 `docker ps --no-trunc` 一致：完整 64 位 ID
const fullId = (short: string) => `${short}${"0".repeat(64 - short.length)}`;
const CONTAINERS = [
  container(fullId("cafe12345678"), "older-app"),
  container(fullId("0123456789ab"), "cafe"),
  container(fullId("abcdef000001"), "api-1"),
  container(fullId("abcdef000002"), "api-2"),
];

function matchedName(target: string): string | null {
  const result = matchDockerContainer(CONTAINERS, target);
  return result.status === "matched" ? result.container.name : result.status;
}

test("exact names win over id prefixes", () => {
  assert.equal(matchedName("cafe"), "cafe");
  assert.equal(matchedName(" older-app "), "older-app");
});

test("short ids, full 64-char ids and unique prefixes resolve", () => {
  assert.equal(matchedName("abcdef000001"), "api-1");
  assert.equal(matchedName(fullId("0123456789ab")), "cafe");
  assert.equal(matchedName("cafe1"), "older-app");
  assert.equal(matchedName("ABCDEF000002"), "api-2");
});

test("a full id with a wrong suffix does not match the container sharing its short id", () => {
  assert.equal(matchedName(`0123456789ab${"c".repeat(52)}`), "not-found");
  assert.equal(matchedName(`${fullId("abcdef000001")}0`), "not-found");
});

test("ambiguous prefixes and empty or unknown targets do not pick a container", () => {
  const ambiguous = matchDockerContainer(CONTAINERS, "abcdef");
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(
    ambiguous.status === "ambiguous" ? ambiguous.candidates.map((c) => c.name) : [],
    ["api-1", "api-2"],
  );
  assert.equal(matchedName(""), "not-found");
  assert.equal(matchedName("   "), "not-found");
  assert.equal(matchedName("missing-container"), "not-found");
});
