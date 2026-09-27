import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitService } from "../src/git/gitService.js";
import { parseGitlinkPaths, parseStatusPorcelain } from "../src/git/repo/gitCliHelpers.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c",
      "user.email=tester@example.com",
      "-c",
      "user.name=Tester",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "protocol.file.allow=always",
      ...args,
    ],
    { cwd },
  );
  return stdout;
}

test("status marks submodule entries and leaves other entries unchanged", () => {
  const hash = "0".repeat(40);
  const { entries } = parseStatusPorcelain(
    [
      `1 .M SC.. 160000 160000 160000 ${hash} ${hash} vendor/lib`,
      `1 .M N... 100644 100644 100644 ${hash} ${hash} src/app.ts`,
      `2 R. S... 160000 160000 160000 ${hash} ${hash} R100 libs/new`,
      "libs/old",
      `u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} conflict.txt`,
      "",
    ].join("\0"),
  );
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.isSubmodule ?? false]),
    [
      ["vendor/lib", true],
      ["src/app.ts", false],
      ["libs/new", true],
      ["conflict.txt", false],
    ],
  );
  assert.equal("isSubmodule" in entries[1]!, false);
  assert.equal(entries[2]!.originalPath, "libs/old");
});

test("raw diff output yields the gitlink paths only", () => {
  const paths = parseGitlinkPaths(
    [
      ":160000 160000 abc1234 def5678 M",
      "vendor/lib",
      ":100644 100644 abc1234 def5678 M",
      "src/app.ts",
      ":000000 160000 0000000 def5678 A",
      "libs/new",
      "",
    ].join("\0"),
  );
  assert.deepEqual([...paths], ["vendor/lib", "libs/new"]);
});

test("changes and the branch comparison flag a changed submodule, not files", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-git-submodule-"));
  try {
    const sub = join(root, "sub");
    const remote = join(root, "remote.git");
    const main = join(root, "main");
    await git(root, "init", "-q", "-b", "main", sub);
    await git(sub, "commit", "-q", "--allow-empty", "-m", "s1");
    await git(root, "init", "-q", "--bare", "-b", "main", remote);
    await git(root, "init", "-q", "-b", "main", main);
    await writeFile(join(main, "a.txt"), "a\n");
    await git(main, "add", "a.txt");
    await git(main, "commit", "-q", "-m", "init");
    await git(main, "submodule", "add", "-q", sub, "sub");
    await git(main, "commit", "-q", "-m", "add sub");
    await git(main, "remote", "add", "origin", remote);
    await git(main, "push", "-q", "-u", "origin", "main");

    // 分支对比：子模块指向新提交，普通文件也有改动。
    await git(join(main, "sub"), "commit", "-q", "--allow-empty", "-m", "s2");
    await writeFile(join(main, "a.txt"), "a\nb\n");
    await git(main, "add", "sub", "a.txt");
    await git(main, "commit", "-q", "-m", "bump");
    // 工作区：子模块再前进一个提交，未暂存。
    await git(join(main, "sub"), "commit", "-q", "--allow-empty", "-m", "s3");

    const service = createGitService();
    const unstaged = await service.getChanges({ workspacePath: main, sourceId: "unstaged" });
    assert.deepEqual(
      unstaged.map((change) => [change.repoRelativePath, change.isSubmodule ?? false]),
      [["sub", true]],
    );
    const comparison = await service.getBranchComparison({ workspacePath: main });
    assert.deepEqual(
      comparison.changes
        .map((change) => [change.repoRelativePath, change.isSubmodule ?? false])
        .sort(),
      [
        ["a.txt", false],
        ["sub", true],
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
