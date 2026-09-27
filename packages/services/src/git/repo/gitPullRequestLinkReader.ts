import { buildGitPullRequestLink, type GitPullRequestLink } from "@zcode/shared";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";

const REFS_HEADS_PREFIX = "refs/heads/";

/**
 * 读取当前分支推送到的远程与分支，构造托管平台新建 PR 的网页链接（只读，不访问网络）。
 * 规范：docs/specs/git-pull-request-link.md
 * 修复原因：以前只看上游（branch.<name>.remote/merge）；配置了 branch.<name>.pushRemote 或 remote.pushDefault 时，
 * 不带参数的 git push 会推送到另一个远程（如 fork），链接却指向上游仓库、用上游分支名作来源，
 * 该分支可能不存在；上游分支就是默认分支时甚至没有链接。
 * 修复依据：按 git 的规则取推送目标：pushRemote → pushDefault → 上游远程。推送到上游远程时推送的是上游分支；
 * 推送到其它远程时（push.default 为 simple/current/matching）推送同名分支。链接指向推送到的仓库。
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

  const [upstreamRemote, mergeRef, branchPushRemote, pushDefault] = await Promise.all([
    readTrimmed(["config", "--get", `branch.${context.branchName}.remote`]),
    readTrimmed(["config", "--get", `branch.${context.branchName}.merge`]),
    readTrimmed(["config", "--get", `branch.${context.branchName}.pushRemote`]),
    readTrimmed(["config", "--get", "remote.pushDefault"]),
  ]);
  const remoteName = branchPushRemote ?? pushDefault ?? upstreamRemote;
  // `.` 表示本地仓库，没有可以发起 PR 的远程。
  if (!remoteName || remoteName === ".") {
    return null;
  }
  let headBranch: string;
  if (remoteName === upstreamRemote) {
    if (!mergeRef?.startsWith(REFS_HEADS_PREFIX)) return null;
    headBranch = mergeRef.slice(REFS_HEADS_PREFIX.length);
  } else {
    headBranch = context.branchName;
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
    headBranch,
    baseBranch: remoteHead?.startsWith(remotePrefix) ? remoteHead.slice(remotePrefix.length) : null,
  });
}
