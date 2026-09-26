/**
 * 由远程地址与分支构造托管平台“新建 PR / MR”网页地址（纯函数）。
 * 规范：docs/specs/git-pull-request-link.md
 */
export type GitPullRequestProvider = "github" | "gitlab" | "bitbucket";

export interface GitPullRequestLink {
  provider: GitPullRequestProvider;
  url: string;
  headBranch: string;
  baseBranch: string | null;
}

interface GitRemoteWebLocation {
  /** 网页 origin，例如 `https://github.com`；不含任何凭据。 */
  origin: string;
  host: string;
  /** `owner/repo` 或 `group/subgroup/repo`，不含 `.git`。 */
  path: string;
}

const HOST_PATTERN = /^[A-Za-z0-9.-]+$/;
/** 多账号常见的 ssh 别名写法：`github.com-work`、`gitlab.com_personal`。 */
const SSH_ALIAS_OF_KNOWN_HOST = /^(github\.com|gitlab\.com|bitbucket\.org)[-_][A-Za-z0-9._-]+$/i;

/**
 * ssh / scp 形式里的“主机”可能只是 ~/.ssh/config 的别名，不能直接当网页主机。
 * 修复原因：`git@github.com-work:org/repo.git` 之前被当成 github 主机，拼出打不开的 `https://github.com-work/...`。
 * 修复依据：已知平台的“主机名-后缀”别名还原为规范主机；不含点的裸别名无法推断网页主机，放弃生成链接。
 */
function resolveSshWebHost(host: string): string | null {
  const alias = SSH_ALIAS_OF_KNOWN_HOST.exec(host);
  if (alias) return alias[1]!.toLowerCase();
  return host.includes(".") ? host : null;
}
const SCP_REMOTE_PATTERN = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/;

function normalizeRepositoryPath(rawPath: string): string | null {
  const segments = rawPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/");
  if (segments.length < 2 || segments.some((segment) => segment === "" || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

/** 解析远程地址为网页位置；凭据、ssh 端口一律丢弃，无法识别时返回 null。 */
export function parseGitRemoteWebLocation(remoteUrl: string): GitRemoteWebLocation | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const host = url.hostname;
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    const path = normalizeRepositoryPath(pathname);
    if (!path) {
      return null;
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      if (!HOST_PATTERN.test(host)) return null;
      const port = url.port ? `:${url.port}` : "";
      return { origin: `${url.protocol}//${host}${port}`, host, path };
    }
    if (url.protocol === "ssh:" || url.protocol === "git:" || url.protocol === "git+ssh:") {
      const webHost = resolveSshWebHost(host);
      return webHost && HOST_PATTERN.test(webHost)
        ? { origin: `https://${webHost}`, host: webHost, path }
        : null;
    }
    return null;
  }

  const scp = SCP_REMOTE_PATTERN.exec(trimmed);
  if (!scp) {
    return null;
  }
  const host = scp[1]!;
  const path = normalizeRepositoryPath(scp[2]!);
  const webHost = resolveSshWebHost(host);
  if (!webHost || !HOST_PATTERN.test(webHost) || !path) {
    return null;
  }
  return { origin: `https://${webHost}`, host: webHost, path };
}

function detectProvider(host: string): GitPullRequestProvider | null {
  const lowerHost = host.toLowerCase();
  if (lowerHost === "github.com" || lowerHost.includes("github")) return "github";
  if (lowerHost === "gitlab.com" || lowerHost.includes("gitlab")) return "gitlab";
  if (lowerHost === "bitbucket.org") return "bitbucket";
  return null;
}

function encodeBranchPath(branch: string): string {
  return encodeURIComponent(branch).replace(/%2F/g, "/");
}

export function buildGitPullRequestLink(input: {
  remoteUrl: string;
  headBranch: string;
  baseBranch: string | null;
}): GitPullRequestLink | null {
  const headBranch = input.headBranch.trim();
  const baseBranch = input.baseBranch?.trim() || null;
  if (headBranch.length === 0 || headBranch === baseBranch) {
    return null;
  }
  const location = parseGitRemoteWebLocation(input.remoteUrl);
  const provider = location ? detectProvider(location.host) : null;
  if (!location || !provider) {
    return null;
  }

  const repositoryUrl = `${location.origin}/${location.path}`;
  let url: string;
  if (provider === "github") {
    const range = baseBranch
      ? `${encodeBranchPath(baseBranch)}...${encodeBranchPath(headBranch)}`
      : encodeBranchPath(headBranch);
    url = `${repositoryUrl}/compare/${range}?expand=1`;
  } else if (provider === "gitlab") {
    const params = new URLSearchParams({ "merge_request[source_branch]": headBranch });
    if (baseBranch) params.set("merge_request[target_branch]", baseBranch);
    url = `${repositoryUrl}/-/merge_requests/new?${params.toString()}`;
  } else {
    const params = new URLSearchParams({ source: headBranch });
    if (baseBranch) params.set("dest", baseBranch);
    url = `${repositoryUrl}/pull-requests/new?${params.toString()}`;
  }
  return { provider, url, headBranch, baseBranch };
}
