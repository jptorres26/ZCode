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
    if (!HOST_PATTERN.test(host) || !path) {
      return null;
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      const port = url.port ? `:${url.port}` : "";
      return { origin: `${url.protocol}//${host}${port}`, host, path };
    }
    if (url.protocol === "ssh:" || url.protocol === "git:" || url.protocol === "git+ssh:") {
      return { origin: `https://${host}`, host, path };
    }
    return null;
  }

  const scp = SCP_REMOTE_PATTERN.exec(trimmed);
  if (!scp) {
    return null;
  }
  const host = scp[1]!;
  const path = normalizeRepositoryPath(scp[2]!);
  if (!HOST_PATTERN.test(host) || !path) {
    return null;
  }
  return { origin: `https://${host}`, host, path };
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
