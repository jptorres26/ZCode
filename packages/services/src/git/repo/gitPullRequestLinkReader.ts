import { buildGitPullRequestLink, type GitPullRequestLink } from "@zcode/shared";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";

const REFS_HEADS_PREFIX = "refs/heads/";

/**
 * 读取当前分支的上游与远程地址，构造托管平台新建 PR 的网页链接（只读，不访问网络）。
 * 规范：docs/specs/git-pull-request-link.md
 */
export async function readGitPullRequestLink(context: {
  commandProvider: GitCommandProvider;
  repoRoot: string;
  branchName: string;
}): Promise<GitPullRequestLink | null> {
  const readTrimmed = async (args: string[]): Promise<string | null> => {
    const result = await context.commandProvider.run({
      cwd: context.repoRoot,
      args,
      timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    });
    const value = result.stdout.trim();
    return result.exitCode === 0 && value.length > 0 ? value : null;
  };

  const [remoteName, mergeRef] = await Promise.all([
    readTrimmed(["config", "--get", `branch.${context.branchName}.remote`]),
    readTrimmed(["config", "--get", `branch.${context.branchName}.merge`]),
  ]);
  // `.` 表示上游是本地分支，没有可以发起 PR 的远程。
  if (!remoteName || remoteName === "." || !mergeRef?.startsWith(REFS_HEADS_PREFIX)) {
    return null;
  }

  const [remoteUrl, remoteHead] = await Promise.all([
    readTrimmed(["remote", "get-url", remoteName]),
    readTrimmed(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`]),
  ]);
  if (!remoteUrl) {
    return null;
  }
  const remotePrefix = `${remoteName}/`;
  return buildGitPullRequestLink({
    remoteUrl,
    headBranch: mergeRef.slice(REFS_HEADS_PREFIX.length),
    baseBranch: remoteHead?.startsWith(remotePrefix) ? remoteHead.slice(remotePrefix.length) : null,
  });
}
