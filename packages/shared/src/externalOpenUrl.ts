/**
 * 交给系统默认程序（Electron shell.openExternal）打开的 URL 白名单。
 * Main 进程的 OpenExternal 与渲染层“在默认浏览器中打开”入口共用这一判断，避免 UI 提供了按钮而 Main 静默拦截。
 */
const EXTERNAL_OPEN_FILE_EXTENSIONS = [".html", ".htm"] as const;

/**
 * - http / https：放行；
 * - file：只放行本机（空 host 或 localhost）、非 UNC 的 .html / .htm 文档。
 *
 * 修复原因：只看扩展名时 `file://attacker.example/share/x.html` 与 `file:////host/share/x.html`
 * 都会被放行，Windows 上它们是 UNC 路径，打开时会向远端发起 SMB/WebDAV 认证并泄露 NTLM 凭据。
 * 修复依据：file URL 必须指向本机文件系统；其余本地文件走 OpenExternalFile。
 */
export function isExternalOpenAllowedUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return true;
  }
  if (url.protocol !== "file:") {
    return false;
  }
  if (url.hostname !== "" && url.hostname.toLowerCase() !== "localhost") {
    return false;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  // `file:////host/share` 与反斜杠形式在 WHATWG 解析后都以 `//` 开头，仍是 UNC。
  if (pathname.startsWith("//") || pathname.includes("\\")) {
    return false;
  }
  const lowerPath = pathname.toLowerCase();
  return EXTERNAL_OPEN_FILE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}
