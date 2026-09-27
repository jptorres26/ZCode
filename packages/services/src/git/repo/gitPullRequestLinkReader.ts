import {
  buildGitPullRequestLink,
  parseGitRemoteWebLocation,
  type GitPullRequestLink,
} from "@zcode/shared";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";

const REFS_HEADS_PREFIX = "refs/heads/";

/**
 * 从 `git push --porcelain` 的输出中取出当前分支推送到的远程分支与地址。
 * 每个推送地址一段：`To <url>`，其后每条引用一行 `<flag>\t<from>:<to>\t<summary>`。
 * from 为 `refs/heads/<branch>`，或来自推送 refspec 的 `HEAD`；被拒绝（`!`）与删除（`-`）的行不算。
 * @lintignore
 */
export function findPushedBranch(
  porcelain: string,
  branchName: string,
): { remoteUrl: string; headBranch: string } | null {
  let remoteUrl: string | null = null;
  for (const line of porcelain.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("To ")) {
      remoteUrl = line.slice("To ".length).trim();
      continue;
    }
    const [flag, refs] = line.split("\t");
    if (!remoteUrl || flag === undefined || refs === undefined || flag === "!" || flag === "-") {
      continue;
    }
    // 引用名不能含 `:`（check-ref-format），第一个 `:` 即 from 与 to 的分隔。
    const separator = refs.indexOf(":");
    const from = refs.slice(0, separator);
    const to = refs.slice(separator + 1);
    if (
      separator > 0 &&
      (from === `${REFS_HEADS_PREFIX}${branchName}` || from === "HEAD") &&
      to.startsWith(REFS_HEADS_PREFIX)
    ) {
      return { remoteUrl, headBranch: to.slice(REFS_HEADS_PREFIX.length) };
    }
  }
  return null;
}

/** 两个远程地址是否指向托管平台上的同一个仓库（主机与路径不区分大小写）。 */
function isSameRepository(fetchUrl: string | null, pushUrl: string): boolean {
  const fetched = fetchUrl ? parseGitRemoteWebLocation(fetchUrl.split("\n")[0]!) : null;
  const pushed = parseGitRemoteWebLocation(pushUrl);
  return (
    fetched !== null &&
    pushed !== null &&
    fetched.host.toLowerCase() === pushed.host.toLowerCase() &&
    fetched.path.toLowerCase() === pushed.path.toLowerCase()
  );
}

/**
 * 推送成功后，构造托管平台新建 PR 的网页链接（只读，不访问网络）。规范：docs/specs/git-pull-request-link.md
 * 修复原因：以前按仓库配置推算不带参数的 git push 会推送到哪里（pushRemote、pushDefault、push.default、pushurl），
 * 每漏掉一条规则（如 `remote.<name>.push=HEAD:refs/heads/review-topic`），链接就指向不存在的分支或错误的仓库。
 * 修复依据：源分支与地址取自这次推送的 porcelain 输出，即 git 实际推送的引用与地址，不再重复实现 git 的推送规则。
 */
export async function readGitPullRequestLink(context: {
  commandProvider: GitCommandProvider;
  repoRoot: string;
  branchName: string;
  /** 这次 `git push --porcelain` 的标准输出。 */
  pushOutput: string;
  /** 推送命令中显式指定的远程（`--set-upstream <remote>`）；不带参数的推送为 null。 */
  explicitRemote: string | null;
}): Promise<GitPullRequestLink | null> {
  const pushed = findPushedBranch(context.pushOutput, context.branchName);
  if (!pushed) {
    return null;
  }
  const readTrimmed = async (args: string[]): Promise<string | null> => {
    const result = await context.commandProvider.run({
      cwd: context.repoRoot,
      args,
      timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    });
    const value = result.stdout.trim();
    return result.exitCode === 0 && value.length > 0 ? value : null;
  };
  // 目标分支取推送所用远程的默认分支；不带参数的推送由 git 按当前分支解析推送远程。
  const remoteName =
    context.explicitRemote ??
    (await readTrimmed([
      "for-each-ref",
      "--format=%(push:remotename)",
      `${REFS_HEADS_PREFIX}${context.branchName}`,
    ]));
  const [remoteHead, fetchUrl] = remoteName
    ? await Promise.all([
        readTrimmed(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`]),
        readTrimmed(["remote", "get-url", remoteName]),
      ])
    : [null, null];
  // 修复原因：远程配置了单独的 pushurl（从上游拉取、推送到 fork）时，refs/remotes/<remote>/HEAD 是上游仓库的默认分支，
  // 以它为目标会指向 fork 中可能不存在的分支。修复依据：只有 fetch 地址与推送到的地址是同一个仓库时才取它作目标分支，
  // 否则不带目标分支，由托管平台使用推送到的仓库的默认分支。
  const remotePrefix = `${remoteName}/`;
  const baseBranch =
    remoteHead?.startsWith(remotePrefix) && isSameRepository(fetchUrl, pushed.remoteUrl)
      ? remoteHead.slice(remotePrefix.length)
      : null;
  return buildGitPullRequestLink({
    remoteUrl: pushed.remoteUrl,
    headBranch: pushed.headBranch,
    baseBranch,
  });
}
