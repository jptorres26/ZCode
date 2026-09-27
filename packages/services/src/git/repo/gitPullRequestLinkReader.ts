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

  const [upstreamRemote, mergeRef, branchPushRemote, pushDefaultRemote, pushDefaultMode] =
    await Promise.all([
      readTrimmed(["config", "--get", `branch.${context.branchName}.remote`]),
      readTrimmed(["config", "--get", `branch.${context.branchName}.merge`]),
      readTrimmed(["config", "--get", `branch.${context.branchName}.pushRemote`]),
      readTrimmed(["config", "--get", "remote.pushDefault"]),
      readTrimmed(["config", "--get", "push.default"]),
    ]);
  const remoteName = branchPushRemote ?? pushDefaultRemote ?? upstreamRemote;
  // `.` 表示本地仓库，没有可以发起 PR 的远程。
  if (!remoteName || remoteName === ".") {
    return null;
  }
  // 修复原因：推送到上游所在的远程时一律取上游分支，但 push.default 为 current/matching 时推送的是同名分支，
  // 链接的源分支会错。修复依据：只有 push.default 为 upstream（旧名 tracking）且推送到上游所在的远程时，
  // 推送目标才是上游分支；simple（默认）在分支名不同的情况下拒绝推送，其余情况都推送同名分支。
  const pushesToUpstreamBranch =
    remoteName === upstreamRemote &&
    (pushDefaultMode === "upstream" || pushDefaultMode === "tracking");
  let headBranch: string;
  if (pushesToUpstreamBranch) {
    if (!mergeRef?.startsWith(REFS_HEADS_PREFIX)) return null;
    headBranch = mergeRef.slice(REFS_HEADS_PREFIX.length);
  } else {
    headBranch = context.branchName;
  }

  // 修复原因：远程配置了单独的 remote.<name>.pushurl（从上游拉取、推送到 fork）时，推送去的是 push URL，
  // 读 fetch URL 会把链接建到错误的仓库。修复依据：读取 push URL（未配置时 git 回退为 fetch URL）。
  const [remoteUrl, remoteHead] = await Promise.all([
    readTrimmed(["remote", "get-url", "--push", remoteName]),
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
