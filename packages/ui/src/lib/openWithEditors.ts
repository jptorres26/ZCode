import type { EditorInfo } from "@zcode/shared";

// 修复原因：Linux 的文件管理器目标 id 为 file-manager，不在列表中时办公模式会把它过滤掉，Linux 用户没有打开入口。
// 修复依据：与 Finder / 资源管理器同等归类并置顶（docs/specs/open-in-editor-linux.md）。
const PINNED_OPEN_WITH_EDITOR_IDS = [
  "finder",
  "qspace",
  "qspace-pro",
  "explorer",
  "file-manager",
] as const;

export function isFileManagerOpenTarget(editor: EditorInfo): boolean {
  return (PINNED_OPEN_WITH_EDITOR_IDS as readonly string[]).includes(editor.id);
}

export function sortInstalledEditorsForOpenWith(editors: EditorInfo[]): EditorInfo[] {
  const editorById = new Map(editors.map((editor) => [editor.id, editor]));
  const pinnedEditors = PINNED_OPEN_WITH_EDITOR_IDS.map(
    (editorId) => editorById.get(editorId) ?? null,
  ).filter((editor): editor is EditorInfo => editor !== null);
  const pinnedEditorIds = new Set<string>(PINNED_OPEN_WITH_EDITOR_IDS);
  const regularEditors = editors.filter((editor) => !pinnedEditorIds.has(editor.id));

  return [...pinnedEditors, ...regularEditors];
}
