# Context usage popover: manual compaction entry

> English translation of [context-usage-compact-action.md](context-usage-compact-action.md). The Chinese file is the normative source; keep both in sync.

## Background

Hovering the context usage ring in the composer toolbar (`ChatContextUsage`) shows used / limit,
the per-source breakdown, and the cache hit rate. `SessionPane` already passes
`onSendCompressionCommand` and `compressionDisabled` down to that component, and the
`chat.contextUsage.compress*` strings exist, but the component never rendered an entry, so users
could only type `/compact` by hand. Codex desktop likewise offers in-place compaction as the
context approaches its limit; this spec adds that entry.

## Behavior

- Only when the popover shows this task's context usage (`renderableTaskUsage` exists) and the
  caller provides `onSendCompressionCommand`, a row with a description and a "Compress" button
  appears below the usage bar (the title row is already filled by "Context window" and the usage
  summary; the description may wrap to fit longer translations).
- Click: close the popover first, then call `onSendCompressionCommand` with
  `getContextCompressionCommand(provider)` (currently `/compact`), the same
  `dispatchSlashCommand` path as typing the slash command; no new state and no new protocol.
- The button is disabled when `compressionDisabled` is set (composer disabled or recovering).
- The description is `chat.contextUsage.compressDescription` (including the command name).
- Visuals: `Button variant="ghost" size="sm"`; the popover is `rounded-xl`, so the button uses
  `rounded-lg`; text uses `text-ui-*` and no new colors are introduced.

## Acceptance

- Web dev server + local mock model: after one turn, hovering the context ring shows the
  "Compress" button; clicking it closes the popover, the mock model receives a compaction request,
  and the compaction result appears in the conversation.
- A new task draft (no usage yet) does not show the button.
