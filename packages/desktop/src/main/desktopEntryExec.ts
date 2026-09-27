/**
 * Desktop Entry `Exec` 参数的引用规则（纯函数）。
 *
 * 规范要点：
 * 1. 字面 `%` 写成 `%%`，否则会被当成 field code；
 * 2. 引号内的 `"`、`` ` ``、`$`、`\` 前加反斜杠（Exec 引用层）；
 * 3. Exec 是 string 类型值，读取时先按通用字符串转义把 `\\` 还原成 `\`（字符串转义层），
 *    因此写入时需要在引用层结果上再把每个反斜杠加倍：字面反斜杠最终是四个 `\\\\`，`$` 是 `\\$`。
 *
 * 修复原因：之前只做了引用层，写出的 `\$`、`\"` 在 GLib 等实现的字符串层是非法转义，
 * 字面反斜杠也会少一层，AppImage 路径含这些字符时深链接启动命令会被错误解析。
 * 修复依据：freedesktop Desktop Entry 规范 “The Exec key” 一节对四个反斜杠的说明。
 * 修复原因：路径中的换行符（Linux 文件名允许）按原样写入会结束 `Exec=` 这一行，GLib 视整个条目为非法，`zcode://`
 * 深链接无法启动。修复依据：字符串层的转义还包括 `\n`、`\t`、`\r`，控制字符写成这些转义序列。
 */
export function quoteDesktopEntryExecArg(value: string): string {
  const quoted = value.replace(/%/g, "%%").replace(/[\\"`$]/g, (match) => `\\${match}`);
  const escaped = quoted
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}
