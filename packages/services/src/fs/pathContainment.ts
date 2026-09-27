import { isAbsolute, sep } from "node:path";

/**
 * `path.relative(parent, child)` 的结果是否仍在 parent 之内（含 parent 自身时为空字符串）。
 * 修复原因：只看是否以 `..` 开头时，`..cache` 这类以两个点开头的子目录名会被当成在 parent 之外。
 * 修复依据：只有恰为 `..`、或以 `..` 加路径分隔符开头的相对路径才表示离开 parent。
 */
export function isRelativePathInside(relativePath: string): boolean {
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !relativePath.startsWith("../") &&
    !isAbsolute(relativePath)
  );
}
