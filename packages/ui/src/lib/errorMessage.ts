export function getErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);

  // 远程连接链路里有的错误已经带了 "Error: ..." 前缀，
  // 上层再包装成 Error 或直接 String(error) 展示时，会叠成 "Error: Error: ..."。
  // 这里统一剥掉重复前缀，只保留真正有意义的错误内容。
  return rawMessage.replace(/^(Error:\s*)+/i, "").trim();
}

/**
 * 日志用的错误类别：错误码（如 ENOENT）或错误名称。错误信息常含路径、分支名或远程地址，
 * 只在界面提示中展示，不写入会在生产环境落盘的日志。
 */
export function getErrorKindForLog(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return String(code);
    if (error instanceof Error) return error.name;
  }
  return typeof error;
}
