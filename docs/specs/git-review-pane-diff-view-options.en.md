# Review pane diff view options (split / unified, line wrap)

> Chinese version: [git-review-pane-diff-view-options.md](git-review-pane-diff-view-options.md). The Chinese file is normative; keep both in sync.

## Background

The Codex desktop Review pane can switch between a unified and a split (side-by-side) diff and can
toggle wrapping long lines. ZCode's rich diff component `DiffViewer` hard-codes
`diffStyle: "unified"` and `overflow: "scroll"`. The global "Wrap long lines" setting only reaches
the lightweight diff and code blocks, not rich diffs.

## State owners

| State                                                           | Owner                                                            | Persistence                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Review pane diff layout `reviewDiffStyle: "unified" \| "split"` | `useZCodeStore().codePreviewSettings` (`setCodePreviewSettings`) | Same as the other code preview settings: this device's localStorage. Defaults to `"unified"`; an invalid stored value falls back to the default |
| Global "Wrap long lines" `wrapLongLines`                        | Same (existing field)                                            | Same                                                                                                                                            |
| Review pane wrap override                                       | Local state in `GitPane`, `wrapOverride: boolean \| null`        | Not persisted, matching the file viewer's "Wrap lines" menu item                                                                                |

- Effective wrap in the Review pane = `wrapOverride ?? codePreviewSettings.wrapLongLines`.
- No new service and no RPC: these are display preferences only and do not affect Git data or
  agent behavior.

## Interface

- `DiffViewer` gets optional props `diffStyle?: "unified" | "split"` (default `"unified"`) and
  `wrapLongLines?: boolean` (default `false`, mapped to `overflow: "wrap" | "scroll"`). An
  `options` override from the caller still wins over both.
- Rich diffs in the file viewer (`previewPaneContent`, `previewPanePatchFallbackContent`) pass the
  global `wrapLongLines`, so the global setting applies to every rich diff. They stay unified.

## Interaction

- The Review pane header gets a "Diff view options" icon button next to Refresh. Its menu has:
  - a "Layout" radio group, Unified / Split, which writes `reviewDiffStyle`;
  - a "Wrap lines" checkbox, which writes `wrapOverride`.
- Narrow pane: while the pane is narrower than 640px (including the mobile web side pane), the
  effective layout is forced to unified, and "Split" is disabled with the hint "Widen the pane to
  use split view". The saved preference is kept, so split comes back once the pane is wide enough.
  The width comes from a `ResizeObserver` on the Review pane root.
- Strings live under `git.viewOptions.*`, in both `en-US` and `zh-CN`.

## Acceptance

- `packages/ui/test/gitPaneDiffViewOptions.test.ts`: invalid stored preference falls back, a
  narrow pane forces unified, and the wrap override wins over the global setting.
- Web dev server + Playwright: expand a file's diff; switching to Split shows two columns; turning
  on Wrap lines removes horizontal scrolling for long lines; at phone width "Split" is disabled and
  the diff is unified; the layout preference survives a page reload.
