> English translation of [README.md](README.md). The Chinese file is the normative source; keep both in sync.

# @zcode/dynamic-workflow-runtime

Sandbox harness (the dynamic-workflow execution engine). Runs a workflow script inside a controlled child process and bridges the child's `__host.*` calls over NDJSON to the pure engine core in `@zcode/dynamic-workflow`.

## Dependency boundary

Depends **only** on `@zcode/dynamic-workflow` (workspace) and Node built-ins. **Never** import `@zcode/core` / `@zcode/contracts` / `@zcode/bootstrap` / `@zcode/adapters`. This package is the proof that the whole sandbox↔engine pipeline runs app-free.

## Usage

```ts
import { runWorkflowScript } from "@zcode/dynamic-workflow-runtime";

const settlement = await runWorkflowScript({
  scriptText,                 // or lowered: <async function body>
  caps: { maxConcurrency: 16 },
  askSpecs,                   // a site id present in the synthesized schemas record is "typed"
  validate,                   // validate from @zcode/dynamic-workflow (adapted to ValidateFn)
  makeDriver: (sink) => driver, // the driver owns journal + emit; sink is the engine's upward reporting surface
  signal,                     // optional: AbortSignal
  timeoutMs,                  // optional: wall-clock timeout
});
// settlement: { status: "completed", artifact } | { status: "failed", error } | { status: "cancelled" }
```

## Architecture

```
┌─ parent (harness) ──────────────┐  NDJSON  ┌─ child (vm.createContext) ──────────────┐
│ runWorkflowScript               │  stdio   │ only ES intrinsics + __host              │
│  - lower(scriptText)            │◀────────▶│  createActor returns a local handle sync │
│  - WorkflowEngine(driver,...)   │          │  ask/worldRead → request to parent       │
│  - bridge __host.* ↔ engine     │          │  args frozen as globals (cross once at spawn) │
│  - spawn/kill/timeout/abort     │          │  Date.now/Math.random banned at run time │
└─────────────────────────────────┘          └──────────────────────────────────────────┘
```

## NDJSON wire protocol

See `src/protocol.ts` (the single source of truth). child→parent: `create-actor` (fire-and-forget) / `request` (ask, world-read) / `event` (log) / `complete`; parent→child: `response`.

## Build order

Tests and typecheck resolve the dependency through the **built dist** of `@zcode/dynamic-workflow`, so `pretest` / `pretypecheck` first run `pnpm --filter @zcode/dynamic-workflow build`. On a fresh checkout `pnpm test` just works and never hits a stale dist.

## Failure settlement and trade-offs

- The engine owns the run's settlement. Every terminal failure (script throw / child crash / timeout / corrupted protocol) calls `engine.fail(error)`: settles `failed`, the driver cancels in-flight asks, and the journal records `dwf_run.status = "failed"` + `failure_json`, so the journal and the caller see the same result. The abort signal is the only "true cancel" and calls `engine.cancel()` (settles `cancelled`, resumable). The harness-side first-wins finalize only handles child cleanup (clear timer, close stdin, kill child); it never fabricates a settlement.
