import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitService } from "../src/git/gitService.js";

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
      ...args,
    ],
    { cwd },
  );
  return stdout;
}

test("files gone from the working tree are flagged in every source", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-git-missing-"));
  try {
    const remote = join(root, "remote.git");
    const main = join(root, "main");
    await git(root, "init", "-q", "--bare", "-b", "main", remote);
    await git(root, "init", "-q", "-b", "main", main);
    await writeFile(join(main, "kept.txt"), "a\n");
    await writeFile(join(main, "staged-then-deleted.txt"), "a\n");
    await writeFile(join(main, "branch-then-deleted.txt"), "a\n");
    await git(main, "add", ".");
    await git(main, "commit", "-q", "-m", "init");
    await git(main, "remote", "add", "origin", remote);
    await git(main, "push", "-q", "-u", "origin", "main");
    // 分支对比中有改动、随后在本地删除（未提交）
    await writeFile(join(main, "branch-then-deleted.txt"), "a\nb\n");
    await writeFile(join(main, "kept.txt"), "a\nb\n");
    await git(main, "commit", "-q", "-am", "change");
    await unlink(join(main, "branch-then-deleted.txt"));
    // MD：index 中已修改，工作区中已删除
    await writeFile(join(main, "staged-then-deleted.txt"), "a\nb\n");
    await git(main, "add", "staged-then-deleted.txt");
    await unlink(join(main, "staged-then-deleted.txt"));

    const service = createGitService();
    const flags = (
      changes: Array<{ repoRelativePath: string; isMissingInWorkingTree?: boolean }>,
    ) =>
      changes
        .map((change) => [change.repoRelativePath, change.isMissingInWorkingTree ?? false])
        .sort();
    const staged = await service.getChanges({ workspacePath: main, sourceId: "staged" });
    assert.deepEqual(flags(staged), [["staged-then-deleted.txt", true]]);
    assert.equal(staged[0]!.kind, "modified");
    const unstaged = await service.getChanges({ workspacePath: main, sourceId: "unstaged" });
    assert.deepEqual(flags(unstaged), [
      ["branch-then-deleted.txt", true],
      ["staged-then-deleted.txt", true],
    ]);
    const comparison = await service.getBranchComparison({ workspacePath: main });
    assert.deepEqual(flags(comparison.changes), [
      ["branch-then-deleted.txt", true],
      ["kept.txt", false],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
