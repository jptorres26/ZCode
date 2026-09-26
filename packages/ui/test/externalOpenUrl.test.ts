import assert from "node:assert/strict";
import test from "node:test";
import { isExternalOpenAllowedUrl } from "../../shared/src/externalOpenUrl.js";
import { isDefaultBrowserOpenableUrl } from "../src/embeddedBrowserHelpers.js";

test("web URLs and local html documents can be opened externally", () => {
  for (const url of [
    "https://example.com/docs",
    "http://localhost:3000/",
    "file:///Users/example/report.html",
    "file:///C:/Users/example/Report.HTM",
    "file://localhost/tmp/page.html?x=1#top",
    "file:///tmp/a%20b.html",
  ]) {
    assert.equal(isExternalOpenAllowedUrl(url), true, url);
    assert.equal(isDefaultBrowserOpenableUrl(url), true, url);
  }
});

test("remote hosts, UNC paths and non-html local files are rejected", () => {
  for (const url of [
    "file://attacker.example/share/x.html",
    "file:////attacker.example/share/x.html",
    "file:///%5C%5Cattacker.example%5Cshare%5Cx.html",
    "file:///Applications/Calculator.app",
    "file:///tmp/run.command",
    "file:///C:/Windows/System32/calc.exe",
    "file:///tmp/notes.txt",
    "file:///tmp/bad%E0%A4%A.html",
    "javascript:alert(1)",
    "zcode://open",
    "not a url",
  ]) {
    assert.equal(isExternalOpenAllowedUrl(url), false, url);
    assert.equal(isDefaultBrowserOpenableUrl(url), false, url);
  }
});
