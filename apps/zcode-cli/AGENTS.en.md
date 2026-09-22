> English translation of [AGENTS.md](AGENTS.md). The Chinese file is the normative source; keep both in sync.

# Agent instructions

This is a TypeScript Node.js coding-agent CLI that supports mainstream models and operating systems. General working rules follow the [root AGENTS.md](../../AGENTS.en.md); this file adds CLI-specific rules. Node.js and package-manager versions are defined by [mise.toml](../../mise.toml) and [package.json](../../package.json) at the repository root.

## Working rules (most important)

- Before adding or changing behavior, write or update the corresponding spec first, defining product rules, state owners, interfaces, and acceptance scenarios, then implement the code. Prefer reusing existing documents; create documents and directories as needed, and do not assume a fixed-version design directory exists.
- Next, test cases are critical: they prove whether the result matches expectations.
- Leave a trail: after adding a feature, leave new documentation; after a bug fix, write the cause of the bug in a comment.
- Keep the project agent-friendly: leave logs or interfaces so an agent can fully take over operations.
- Long-running tasks first: the core agent loop is designed by default for sustainable complex tasks and does not use the number of tool calls as a hard stop. Resource and safety boundaries are provided by explicit conditions: automatic compaction at the token/context limit, user cancellation, permission denial, tool timeouts, output truncation, provider retry limits, and so on.
- A single source file must not exceed 400 lines by default; beyond that, split into modules with high cohesion and low coupling rather than piling responsibilities into a large file.
- Extract string, numeric, and other constants into named variables or constants; do not scatter literals through business logic, so they can be changed in one place and maintained consistently.
- Before changing the database schema, agree the approach with the module maintainer, covering migration, compatibility, and rollback strategy.
- Keyboard first: all core logic must be operable from the keyboard. Mouse operation is an enhancement.

## Tooling rules

- Before interacting with the operating system, consider Windows, macOS, and Linux at the same time.
- Keep the default release path as standard Node.js CLI packaging.
- Project-owned environment variables use the `ZCODE_` prefix, but do not add environment variables casually. Before adding one, define its purpose, priority, error behavior, and test coverage in the spec of the corresponding feature. Prefer configuration files, CLI arguments, or session configuration over environment variables wherever possible.

## Open-source content and sensitive information

- Project license and attribution notices are in [LICENSE](../../LICENSE), [NOTICE.md](../../NOTICE.en.md), and [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) at the repository root. Before introducing third-party code, documentation, prompts, or assets, confirm their source, license, and usage rights, and preserve copyright, attribution, and modification notices as the applicable license requires. Do not remove still-applicable attribution notices in the name of open-source cleanup.
- Documentation, examples, test data, logs, and commit messages must not contain real credentials, user privacy, internal service addresses, personal working directories, or content not authorized for publication; examples use fictional data and placeholder values.
- Verify the actual delivery scope before publishing; when Git history is included, check the history as well. Deleting or replacing content in current files does not mean the history has been cleaned.

## Cross-platform compatibility principles

- All features are designed for Windows, macOS, and Linux by default; do not implement only against the behavior of the current development machine.
- Prefer the cross-platform Node.js standard library (`path`, `url`, `fs`, and so on) for path handling; do not hand-write path separators, absolute-path prefixes, line endings, or temporary-directory locations.
- When running external commands, prefer the argument-array forms of `child_process.spawn` / `execFile`; avoid shell string concatenation, POSIX-only syntax, pipes, redirection, or shell builtins.
- When invoking system commands, editors, shells, package managers, or executables, account for Windows `.cmd` / `.exe`, paths with spaces, argument escaping, environment-variable case sensitivity, and shell differences.
- File-system logic must account for case-sensitivity differences, permission-model differences, symlink support differences, executable-bit differences, line-ending differences, and path-length limits.
- Terminal interaction must be based on capability detection rather than assumed terminal features; color, TTY, Unicode, interactive input, window size, and signal handling all need a fallback for non-interactive or limited environments.
- User, cache, config, temp, and project directories must be obtained through explicit cross-platform resolution logic; do not hard-code Unix-style directory structures.
- When adding a capability that interacts with the system, add or update tests covering cross-platform differences; behavior that cannot be verified on the current system must state the remaining risk in the implementation and its description.

## Module boundaries and interface contracts

- Interaction between modules must happen through explicit, bounded, stable interfaces.
- Every module should be understandable, testable, and replaceable on its own, and expose strict type declarations, interface definitions, or schema declarations.
- Modules are not coupled to each other's implementations; they coordinate through standardized contracts. Callers must not depend on the called module's internal implementation, directory structure, implicit global state, or undeclared conventions.
- A module's public contract should clearly describe capability, inputs, outputs, error shapes, state changes, and side effects.
- When data crosses a process, storage, network, plugin, tool-call, or LLM boundary, prefer a runtime-validatable schema over TypeScript types alone.
- When adding a new inter-module interaction, complete the interface contract first, then implement the logic.

## Converging external I/O boundaries

- All external side effects must be uniformly observable, approvable, cancellable, retryable, queueable, auditable, and testable. Business logic expresses intent only and never touches the outside world directly.
- All external I/O must converge into an explicit infrastructure layer or adapter, including network requests, file-system reads and writes, child-process calls, environment-variable reads, terminal input/output, caches, databases, the system clipboard, and external-service access.
- Outside entry layers, infrastructure layers, and adapters, business modules must not call low-level I/O APIs such as `fetch`, `http`, `fs`, `child_process`, or `process.env` directly; they depend on project-defined interfaces, services, or adapters instead.
- I/O adapters must expose stable type declarations or schemas that define inputs, outputs, error types, timeouts, cancellation, retry semantics, idempotency, and side-effect scope.
- Network access goes through a unified request entry point so that timeouts, retries, backoff, authentication, proxies, custom certificates, rate limiting, logging, auditing, and error normalization are managed centrally.
- File reads and writes go through a unified file-system entry point so that atomic writes, concurrency control, temp files, queued writes, permission errors, path normalization, and cross-platform differences are managed centrally.
- Child-process execution goes through a unified execution entry point so that sandboxing, permission approval, environment variables, timeouts, cancellation, output truncation, streaming output, and exit-code normalization are managed centrally.
- When an I/O operation needs to be made asynchronous, queued, retried, degraded, or audited, handle it at the I/O boundary layer; do not scatter these mechanisms through business logic.

## Tool and side-effect contracts

- Every tool must declare an explicit `inputSchema`, `outputSchema`, whether it is read-only, whether it is destructive, whether it is concurrency-safe, maximum output size, timeout, cancellation semantics, and permission requirements.
- A tool's side-effect scope must be declared explicitly, for example `none`, `workspace`, `git`, `network`, `system`. The permission system, sandbox, and approval flow read these declarations rather than guessing at the call site.
- Tools with side effects should declare idempotency and recovery strategy where possible, to enable retries, rollback, queued execution, and failure recovery later.
- Large tool results must not be fed straight back into the model context; write them to disk or into artifact/storage and return only summaries, previews, and traceable references.
- External extensions such as MCP, plugins, and subagents must be integrated through capability declarations, schema validation, namespace isolation, and permission convergence; they must not gain direct access to internal module implementations.

## Sessions, configuration, and observability

- The coding-agent CLI treats session, message, tool call, permission, checkpoint, queue, and pending state as first-class state objects that support recovery, forking, rollback, and concurrent sessions.
- The TUI is responsible only for input capture, layout rendering, and transient interaction state such as cursor, input box, scroll position, and the current dialog selection. Business state such as session, mode, model, tool, todo, permission, and checkpoint must not be stored in the TUI layer; it is stored by server/bootstrap/core/session and delivered through explicit interfaces or session events.
- Collapse/expand indicators in the TUI uniformly use `+`/`-` (`+` collapsed, `-` expanded); do not use `v` and `>`.
- User-facing confirmation, selection, input, progress, and error-recovery capabilities should be designed as stable interaction request/response interfaces or session events for both the TUI and ZCode Protocol V4 clients. Different clients are only presentation and transport adapters; the interaction flow must not be hard-wired into a single front end.
- All task execution must carry a propagatable `traceId`. By default a `traceId` corresponds to the complete task chain of one top-level session; child sessions, subagents, retried tasks, background queued tasks, and asynchronous I/O created within the session all belong to the same `traceId`.
- `traceId` sits above `sessionId`; `sessionId`, `turnId`, `messageId`, `toolCallId`, `spanId`, `parentSpanId`, and so on are structured sub-identifiers under the `traceId`, used to reconstruct the full call chain.
- All modules, services, adapters, tool runtimes, provider clients, I/O adapters, and permission-decision logic must receive and continue to pass the unified execution context; never drop, overwrite, or generate an unrelated `traceId` midway.
- Any asynchronous task, tool call, external I/O, cross-module call, or child session that cannot be associated with a `traceId` is considered unobservable behavior and should be avoided.
- Providers, models, MCP, storage, network proxies, and certificates are integrated through adapters; session-core must not hard-code specific vendors, transport protocols, or deployment environments.
- Configuration needs explicit layers and priorities, for example system, user, project, session, CLI arguments, and environment variables; security-related configuration must be traceable to its source.
- Embrace the `.agents Protocol` and `AGENTS.md` conventions; later design work, especially configuration discovery, reading, and priority resolution, must be compatible with the `.agents Protocol` by default.
- Keep debugging and observability entry points from the first version, covering model requests, context composition, token/cost, tool calls, I/O, permission decisions, retries, queue backlog, and queue drops.
- Logs, traces, and debug output must avoid leaking keys, tokens, private data, and complete user content; highly sensitive information must go through an explicit controlled debug path.

## Error handling first

- Errors are first-class design objects. When adding features, consider failure paths, error ownership, propagation, and the final user-facing message first.
- By default let errors bubble up until they reach a layer that can actually handle them. Do not casually swallow errors in low-level modules, log and continue, or convert errors into plain strings prematurely.
- Catch errors only when you can recover, retry, degrade, add context, convert them into actionable user prompts, or at the CLI entry boundary.
- When throwing or wrapping errors, preserve the original cause and add necessary context; do not lose the call chain or system error information.
- Users should be able to perceive deep system state; error, waiting, retry, permission, model, tool, and I/O state should surface along the call chain to the CLI/TUI and other user interfaces, while avoiding leaks of keys, private data, and complete raw content.
- Low-level business modules must not call `process.exit` directly, print errors to the terminal directly, or decide the final exit code; the CLI entry layer is responsible for uniformly formatting errors, printing messages, and setting the exit code.
- Do not rely on error text for control flow; when error types must be distinguished, use stable error types, error codes, or structured fields.
- Tests should cover key failure paths, especially the common CLI errors: missing configuration, insufficient permissions, network failure, file-system exceptions, invalid user input, and external command failure.

## Commit conventions

- Create one independent commit per feature-level change.
- Do not mix unrelated features, refactors, dependency updates, and formatting changes in the same commit.
- Keep commits small enough to be reviewed independently.
- When a feature change spans multiple files, commit those files together.
- If a task requires multiple feature-level changes, split them into multiple independent commits in the order they should be reviewed.

## Verification

- Before completing a code change, run `pnpm typecheck` and `pnpm lint` from the repository root; when CLI code is involved, also run `pnpm --dir apps/zcode-cli typecheck` and `pnpm --dir apps/zcode-cli lint`.
- Test entry points are defined by each target package's current `package.json` and the actual test files; do not assume a unified test command exists. Behavior changes must run the corresponding tests; interaction changes must cover E2E scenarios.
- Record honestly which commands were run, their results, and what was not verified; a missing test entry point, an existing failure, or an environment limitation must not be written up as passing.
