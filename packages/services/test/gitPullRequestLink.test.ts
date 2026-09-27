import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { findPushedBranch } from "../src/git/repo/gitPullRequestLinkReader.js";

const execFileAsync = promisify(execFile);

// 推送只走下面的本地假 ssh：隔离环境变量与全局配置中的 URL 改写（如把 GitHub 的 ssh 地址改成 https 的 insteadOf）。
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_CONFIG_")) delete process.env[key];
}
process.env.GIT_CONFIG_NOSYSTEM = "1";
if (process.platform !== "win32") process.env.GIT_CONFIG_GLOBAL = "/dev/null";
const git = async (cwd: string, ...args: string[]) =>
  (await execFileAsync("git", args, { cwd })).stdout;

test("findPushedBranch reads the ref pushed for the current branch and its address", () => {
  const output = [
    "To github.com:example/demo.git",
    "!\trefs/heads/feature:refs/heads/feature\t[rejected] (non-fast-forward)",
    "Done",
    "To github.com:me/demo.git",
    "*\trefs/heads/other:refs/heads/me/other\t[new branch]",
    " \tHEAD:refs/heads/review-topic\tabc..def",
    "Done",
  ].join("\n");
  assert.deepEqual(findPushedBranch(output, "feature"), {
    remoteUrl: "github.com:me/demo.git",
    headBranch: "review-topic",
  });
  assert.deepEqual(
    findPushedBranch("To x:o/r\n=\trefs/heads/a/b:refs/heads/a/b\t[up to date]\nDone\n", "a/b"),
    { remoteUrl: "x:o/r", headBranch: "a/b" },
  );
  // 删除、标签与其它分支都不是当前分支的推送
  assert.equal(
    findPushedBranch(
      "To x:o/r\n-\t:refs/heads/feature\t[deleted]\n*\trefs/tags/v1:refs/tags/v1\t[new tag]\n",
      "feature",
    ),
    null,
  );
});

/**
 * 真实推送：远程地址是 GitHub 的 ssh 形式，`core.sshCommand` 把请求转到本地根目录下的同名裸仓库，
 * 这样 `To <url>` 与链接仍是 GitHub 的地址，而不访问网络。
 */
async function withPushableRepo(
  body: (dir: string, bare: (path: string) => Promise<void>) => Promise<void>,
): Promise<void> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "zcode-git-pr-link-")));
  const dir = join(base, "work");
  const remotes = join(base, "remotes");
  try {
    await mkdir(dir);
    await mkdir(remotes);
    const fakeSsh = join(base, "fake-ssh.sh");
    // simple 变体只传主机与命令：忽略主机，在本地根目录下执行 git-receive-pack '<path>'
    await writeFile(fakeSsh, `#!/bin/sh\ncd '${remotes}' && exec sh -c "$2"\n`, { mode: 0o755 });
    const bare = async (path: string) => {
      await mkdir(join(remotes, path), { recursive: true });
      await git(join(remotes, path), "init", "-q", "--bare");
    };
    await git(dir, "-c", "init.defaultBranch=main", "init", "-q");
    await git(dir, "config", "user.email", "tester@example.com");
    await git(dir, "config", "user.name", "Tester");
    await git(dir, "config", "core.sshCommand", fakeSsh);
    await git(dir, "config", "ssh.variant", "simple");
    await writeFile(join(dir, "a.txt"), "a\n");
    await git(dir, "add", ".");
    await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
    await bare("example/demo.git");
    await git(dir, "remote", "add", "origin", "git@github.com:example/demo.git");
    await git(dir, "push", "-q", "origin", "main");
    await git(dir, "remote", "set-head", "origin", "main");
    await body(dir, bare);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const pushLink = async (dir: string) => (await createGitCliRepo().push(dir)).pullRequestLink;

test("a first push sets the upstream and links to the compare page against the remote HEAD", async () => {
  if (process.platform === "win32") return;
  await withPushableRepo(async (dir) => {
    await git(dir, "checkout", "-q", "-b", "feature/login");
    assert.deepEqual(await pushLink(dir), {
      provider: "github",
      url: "https://github.com/example/demo/compare/main...feature/login?expand=1",
      headBranch: "feature/login",
      baseBranch: "main",
    });
    // 再次推送（已有上游，不带参数）结果相同
    assert.equal((await pushLink(dir))?.headBranch, "feature/login");
  });
});

test("a branch pushed to a fork links to the fork with the pushed branch", async () => {
  if (process.platform === "win32") return;
  await withPushableRepo(async (dir, bare) => {
    await bare("me/demo.git");
    await git(dir, "remote", "add", "fork", "git@github.com:me/demo.git");
    await git(dir, "push", "-q", "fork", "main");
    await git(dir, "remote", "set-head", "fork", "main");
    // 三角工作流：跟踪上游的 main，推送到 fork 的同名分支
    await git(dir, "checkout", "-q", "-b", "fix-typo", "--track", "origin/main");
    await git(dir, "config", "remote.pushDefault", "fork");
    const expected = {
      provider: "github",
      url: "https://github.com/me/demo/compare/main...fix-typo?expand=1",
      headBranch: "fix-typo",
      baseBranch: "main",
    };
    assert.deepEqual(await pushLink(dir), expected);
    // branch.<name>.pushRemote 优先于 remote.pushDefault
    await git(dir, "config", "remote.pushDefault", "origin");
    await git(dir, "config", "branch.fix-typo.pushRemote", "fork");
    assert.deepEqual(await pushLink(dir), expected);
  });
});

test("a remote with a separate push URL links to the repository pushed to", async () => {
  if (process.platform === "win32") return;
  await withPushableRepo(async (dir, bare) => {
    await bare("me/demo.git");
    await git(dir, "remote", "set-url", "--push", "origin", "git@github.com:me/demo.git");
    await git(dir, "checkout", "-q", "-b", "feature/login");
    assert.equal(
      (await pushLink(dir))?.url,
      "https://github.com/me/demo/compare/main...feature/login?expand=1",
    );
  });
});

test("the pushed branch follows push.default and configured push refspecs", async () => {
  if (process.platform === "win32") return;
  await withPushableRepo(async (dir) => {
    await git(dir, "push", "-q", "origin", "main:review-topic");
    await git(dir, "fetch", "-q", "origin");
    await git(dir, "checkout", "-q", "-b", "feature", "--track", "origin/review-topic");
    await git(dir, "commit", "-q", "--allow-empty", "-m", "work");
    const headBranch = async () => (await pushLink(dir))?.headBranch;

    await git(dir, "config", "push.default", "current");
    assert.equal(await headBranch(), "feature");
    await git(dir, "config", "push.default", "upstream");
    assert.equal(await headBranch(), "review-topic");
    await git(dir, "config", "--unset", "push.default");
    // 配置的推送 refspec 优先于 push.default；`HEAD:` 指当前分支
    await git(dir, "config", "remote.origin.push", "HEAD:refs/heads/from-refspec");
    assert.equal(await headBranch(), "from-refspec");
    // refspec 不包含当前分支：推送成功，但当前分支没有被推送，没有链接
    await git(dir, "branch", "-f", "other", "main");
    await git(dir, "config", "remote.origin.push", "refs/heads/other:refs/heads/other");
    assert.equal(await pushLink(dir), null);
  });
});
