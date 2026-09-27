const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const UNC_PATH_RE = /^\\\\/;
const URI_ESCAPE_RE = /%[0-9A-Fa-f]{2}/;

export function getPathLeaf(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function getContainingDirectoryPath(path: string): string | null {
  const trimmedPath = path.trim().replace(/[\\/]+$/, "");
  if (!trimmedPath) {
    return null;
  }

  const lastSeparatorIndex = Math.max(trimmedPath.lastIndexOf("/"), trimmedPath.lastIndexOf("\\"));

  if (lastSeparatorIndex < 0) {
    return null;
  }

  if (lastSeparatorIndex === 0) {
    return trimmedPath[0] ?? null;
  }

  const parentPath = trimmedPath.slice(0, lastSeparatorIndex);
  if (/^[A-Za-z]:$/.test(parentPath)) {
    return `${parentPath}${trimmedPath[lastSeparatorIndex] ?? "\\"}`;
  }

  return parentPath || null;
}

export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_RE.test(path) || UNC_PATH_RE.test(path);
}

export function decodeFilePathUriEscapes(path: string): string {
  if (!URI_ESCAPE_RE.test(path)) {
    return path;
  }

  try {
    // markdown/tool 输出里的本地文件路径可能已经按 URI 编码，
    // 例如 workspace 名里的空格会变成 %20。这里用 decodeURI 只还原路径文本，
    // 保留 %2F 这类分隔符转义，避免把文件名内容误拆成新的路径层级。
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function joinFilePath(basePath: string, childPath: string): string {
  if (!childPath) {
    return basePath;
  }

  if (isAbsoluteFilePath(childPath)) {
    return childPath;
  }

  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  const normalizedBasePath = basePath.replace(/[\\/]+$/, "");
  const normalizedChildPath = childPath.replace(/^[\\/]+/, "");
  return `${normalizedBasePath}${separator}${normalizedChildPath}`;
}

// encodeURI 不转义 # 和 ?，但它们在 URL 里是 fragment/query 分隔符。
// 文件名包含 # 时（如 index#v2.html）生成的 file URL 会被下游 URL 解析截断 pathname
// （只剩 /E:/dir/index），shell 打开必然失败。这里在 encodeURI 之后补转义。
function encodeUriPathForFileUrl(value: string): string {
  return encodeURI(value).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

export function toFileUrl(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");

  if (WINDOWS_ABSOLUTE_PATH_RE.test(path)) {
    return `file:///${encodeUriPathForFileUrl(normalizedPath)}`;
  }

  if (normalizedPath.startsWith("/")) {
    return `file://${encodeUriPathForFileUrl(normalizedPath)}`;
  }

  if (UNC_PATH_RE.test(path)) {
    return `file:${encodeUriPathForFileUrl(normalizedPath)}`;
  }

  return encodeUriPathForFileUrl(normalizedPath);
}

/**
 * `child` 是否为 `parent` 自身或其下的路径；兼容 `/` 与 `\\`，Windows 盘符路径不区分大小写。导出供单测使用。
 * @lintignore
 */
export function isSameOrInsidePath(child: string, parent: string): boolean {
  const normalize = (value: string) => {
    const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[A-Za-z]:/.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  const normalizedChild = normalize(child);
  const normalizedParent = normalize(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

/**
 * `child` 是否位于 `parents` 任一路径下；字面不匹配时再按 `child` 的真实路径比较：经符号链接或 junction
 * 打开的路径字面上不在其下，真实路径却在。`parents` 由调用方给出（通常为字面路径及其真实路径，只解析一次）；
 * `resolvePath` 应返回真实路径（本地 Host 的 realpath）。`child` 无法解析时返回 null（无法判断），
 * 由调用方再用其它方式判断，仍无法判断时应按“在其中”处理。导出供单测使用。
 * @lintignore
 */
export async function isSameOrInsideRealPath(
  child: string,
  parents: readonly string[],
  resolvePath: (path: string) => Promise<string>,
): Promise<boolean | null> {
  if (parents.some((parent) => isSameOrInsidePath(child, parent))) return true;
  const realChild = await resolvePath(child).catch(() => null);
  if (realChild === null) return null;
  return parents.some((parent) => isSameOrInsidePath(realChild, parent));
}

/**
 * 另一个入口是否位于该 worktree 内：先按字面与真实路径（`parents` 为 worktree 的字面路径及真实路径），
 * 仍不匹配时按该入口所在的 ZCode worktree 比较（`readManagedWorktreePath`，不是 ZCode worktree 时为 null）。
 * 修复原因：真实路径与所在 worktree 都读取失败（如 Host 或 Git 暂时出错）时以前按“不在其中”处理，
 * 删除会在该入口的 Agent 仍在 worktree 内运行时进行。修复依据：无法判断时按在其中处理，拒绝删除（fail closed）。
 */
export async function isEntryInsideWorktree(
  entryPath: string,
  worktreePath: string,
  parents: readonly string[],
  deps: {
    resolvePath: (path: string) => Promise<string>;
    readManagedWorktreePath: (path: string) => Promise<string | null>;
  },
): Promise<boolean> {
  const byRealPath = await isSameOrInsideRealPath(entryPath, parents, deps.resolvePath);
  if (byRealPath) return true;
  try {
    return (await deps.readManagedWorktreePath(entryPath)) === worktreePath;
  } catch {
    return byRealPath === null;
  }
}
