> English translation of [AGENTS.md](AGENTS.md). The Chinese file is the normative source; keep both in sync.

## Core principles

- Before adding or changing behavior, update the corresponding spec first; create the directory if it does not exist. Define product rules, state owners, interfaces, and acceptance scenarios before implementing code.
- The currently checked-out source, `package.json`, and the architecture policy are authoritative. Instructions may only describe features, commands, and files the repository actually provides; when a feature is removed, clean up references in instructions and skills at the same time.
- When locating a problem, investigate the cause first unless code changes were explicitly requested. Combine source, logs, and runtime evidence, and distinguish confirmed causes from unverified hypotheses.
- Preserve local changes unrelated to the task; do not restore removed modules or internal dependencies on your own.

## Commands and repository layout

Run `node scripts/check-workspace-freshness.mjs` before starting work to check the baseline. The Node version is defined by `mise.toml`.

Run the following commands from the repository root:

| Purpose                         | Command                                            |
| ------------------------------- | -------------------------------------------------- |
| Type check                      | `pnpm typecheck`                                   |
| Lint                            | `pnpm lint` / `pnpm lint:fix`                      |
| Format check                    | `pnpm fmt:check`                                   |
| Desktop development             | `pnpm dev:desktop`                                 |
| Web development                 | `pnpm dev:web`                                     |
| Pre-push check                  | `pnpm verify:pre-push` (lint + architecture check) |
| Architecture check              | `pnpm architecture:check --changed`                |
| Module reading bundle           | `pnpm architecture:context <module-id>`            |
| Unused dependencies and exports | `pnpm knip`                                        |
| Export reference lookup         | `pnpm dep:refs --list-exports <file>`              |

Test entry points are defined by each target package's current `package.json` and the actual test files. Do not assume a unified unit-test or E2E command exists.

- `packages/desktop`: Electron main, host, renderer.
- `packages/web`, `packages/server`: Web client and server.
- `packages/ui`: shared React components, hooks, and Zustand stores.
- `packages/services`: business services; `packages/rpc`: RPC framework.
- `packages/shared`: shared protocols and types; `packages/client`: Agent client SDK.
- `apps/zcode-cli`: Agent CLI and runtime.
- `CONTEXT.md`: plugin store domain vocabulary; read it before changing related UI.
- `DESIGN.md`: UI design guidelines; read it before changing UI.

## Implementation and verification

- For code changes use `.agents/skills/architecture-governance/SKILL.md`: run the architecture check first, then read the governed context for the target module.
- Avoid duplicated state and multiple write paths. Make the single owner, interface, dependency direction, event order, and idempotency boundary explicit; never paper over synchronization problems with timeouts.
- Add the corresponding tests before changing behavior; interaction changes need E2E scenarios. Check that tests and implementation agree, and actually run the verification that is available. If you did not run it or the environment was limited, say so honestly.
- When fixing a bug, explain the cause and the basis for the fix in a comment (in Chinese, per the upstream convention). When you find a design defect, align with the user first instead of piling on fallback branches.
- For designs involving state, timing, remote, or asynchronous synchronization, use a diagram to show owners and event order.
- You must run `pnpm typecheck` and `pnpm lint` and report the real results; never report an existing failure as passing.
- Use asynchronous file and network I/O; cross-package imports go through public entry points and follow the existing path aliases.
- The UI must not call Repos directly, Services must not reference concrete Runtime implementations, and cross-domain imports of implementation details and circular dependencies are forbidden.

## UI and platform boundaries

- Follow `DESIGN.md`, reuse existing components, and account for layout, interaction, theme, and internationalization on both desktop and mobile Web.
- Components access services through `packages/ui/src/hooks/`; platform operations go through `IPlatformService` (`packages/shared/src/platform.ts`), never `window.zcode` directly.
- Handle the differences between Desktop, Web, local, and remote environments through dependency injection, and support Windows, macOS, and Linux.
- Zustand state lives in `packages/ui/src/store/`. Broadcast-synchronized fields such as theme and language must guard against feedback loops; local UI state must not be mistaken for server-side truth.
- Hook files that contain JSX use the `.tsx` extension.

## Processes, protocol, and remote control

- The Desktop app talks to the Agent over stdio. Protocol changes must be mirrored in `packages/shared/src/zcode-protocol/index.ts` with strict types and runtime validation.
- Main owns windows, native operations, process scheduling, and message forwarding; it does not hold task/session business state.
- Each window uses one window-scoped Local Host; local workspaces share that Host. Remote workspaces are managed by the connection registry inside the window; no separate Desktop Remote Host is created.
- Mobile remote control attaches to the desktop's existing Host attachment and reuses the session runtime; it does not start another Agent, Local Host, or remote session for the phone.
- The Desktop `desktop-continuous` real-time link and the phone's `web-remote-replayable` recovery link must be kept clearly distinct. When changing stream, snapshot, queue, or reconnect logic, verify both semantics.
- The external relay and Main only do authentication, pairing, heartbeat, forwarding, and attachment scheduling; they do not store business state such as task queues or snapshots.
- Accepted busy/running input is serially admitted by the CLI/runtime `CommandInbox`; the Renderer keeps only unsubmitted drafts and the pending optimistic overlay, and the Host owner/lease handles routing.
- Keep the owner/lease, cross-Host routing, and stale-run protections; do not delete a boundary check based on a single code path.

## Workspace identity

- `workspaceIdentity` is used for identity isolation; `workspacePath` is used for file operations, command cwd, Git, and path display.
- The identity key is uniformly `workspaceIdentity?.trim() || workspacePath`, used for deduplication, binding, caching, queues, persistence, and request correlation.
- Remote links pass `workspaceIdentity` and `remoteSessionId` end to end; never match on path alone.
- New interfaces keep a local-path fallback; remote identities reuse the existing construction and parsing helpers rather than hand-written formats in business code.

## Logging

- The UI uses `packages/ui/src/logger.ts`, never `console.log` or `window.zcode?.log` directly.
- Agent/session/runtime service logs use `createServiceLogger(scope)` (`packages/services/src/logger/serviceLogger.ts`).
- `debug` is for high-frequency diagnostics such as raw protocol data, streaming chunks, and per-item tool updates; it is not written to disk in production.
- `info` is for production-relevant events: process and session lifecycle, permission results, one-time initialization.
- `warn` is for recoverable exceptions; `error` is for unrecoverable errors such as crashes, handshake failures, and lost authentication.
- Never write credentials, real user data, or internal service addresses into logs, examples, or commits.
