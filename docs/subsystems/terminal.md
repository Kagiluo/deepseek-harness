# Terminals

English | [中文](terminal.zh.md)

Two independent seams serve terminals. `ctx.terminals` keeps model-driven PTY sessions alive across tool calls: its types come from [`packages/terminal/terminal/src/types.ts`](../../packages/terminal/terminal/src/types.ts) and the [persistent PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) owns the rationale. `ctx.interactiveTerminals` allocates raw terminals a person drives through the browser, over [`packages/terminal/terminal-interactive/src/types.ts`](../../packages/terminal/terminal-interactive/src/types.ts).

## Identity and readiness

`TerminalSessionId` is a service-minted branded id. Optional names are owner-local display metadata; authorization compares the exact owning `Agent`, not a name or guessed id.

`TerminalWaitReason` says why one send returned. It is independent from `TerminalSessionStatus`: silence or timeout may return while the top-level shell remains alive, while `session_exit` means that shell exited rather than an arbitrary foreground child.

```ts type-equiv
/** Why one interactive send returned control to its caller. */
type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

```ts type-equiv
/** Top-level PTY process status, independent of a send's wait reason. */
type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }
```

## Backend and live session

A backend owns how one registered type starts and detects readiness. `TerminalSessionService` publishes the returned session only after setup succeeds, then owns id authorization and cleanup. A backend that cannot clean partial startup resources rejects with `TerminalBackendCleanupError`, allowing disposal to retain the cleanup failure without replacing the caller's cancellation reason. A backend session owns terminal state and captured-resource quiescence.

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## Send and retained output

One live session accepts one active send. Its operation exposes a consuming output cursor for generic background jobs and one terminal result for a foreground caller. `TerminalReadResult` separately pages the bounded session scrollback.

```ts type-equiv
/** Live backend-owned send; exactly one may be active per PTY session. */
interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}
```

```ts type-equiv
/** Settled result for one foreground or background send. */
interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}
```

## Ownership and durability

`TerminalSessionService` attaches one awaited cleanup to the exact owner scope, rejects foreign operations, and keeps sessions alive across backend or tool-plugin reload. PTY state and raw bytes remain process-local. Model input and bounded returned output are durable through the existing `tool/call`, `tool/result`, and task-result paths rather than duplicate PTY session events.

## Interactive terminals

`InteractiveTerminalService` serves the terminal a person drives: it mints opaque terminal ids, routes allocation through registered `InteractiveTerminalProvider` types, retains output produced before a consumer attaches, and waits for quiescent cleanup. It is fenced on the exact owning `Session` rather than an `Agent`, and it neither renders text nor tracks readiness — a consumer is a terminal emulator, so the stream carries raw bytes and the consumer owns what a screen does with them.

The two seams stay separate because their contracts are incompatible in the same Context key: `ctx.terminals` is Agent-owned, line-oriented, and returns sanitized rendered text, while a browser UI has no `Agent`, needs the bytes an emulator consumes, and needs window resize. `ctx.terminalController` is the Remote surface over the interactive seam, carrying it to the browser as the `terminals` namespace.

```ts type-equiv
/** Top-level terminal process status, independent of the frame that carried it. */
type InteractiveTerminalStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
```

```ts type-equiv
/**
 * One frame of a terminal's live stream.
 *
 * The stream carries raw bytes rather than rendered text because its consumer
 * is a terminal emulator on the Client: escape sequences, cursor movement, and
 * partial UTF-8 sequences must survive the wire exactly as the shell wrote them.
 */
type InteractiveTerminalFrame =
  | { readonly kind: 'output'; readonly data: Uint8Array }
  /** The terminal substrate failed; the stream yields this frame once and then completes. */
  | { readonly kind: 'failed'; readonly message: string }
  /** The top-level process ended; the stream yields this frame once and then completes. */
  | { readonly kind: 'exit'; readonly status: InteractiveTerminalStatus }
```

```ts type-equiv
/** Replaceable provider for one interactive terminal type. */
interface InteractiveTerminalProvider {
  /** Stable type selected by {@link InteractiveTerminalOpenRequest.type}. */
  readonly type: string
  /**
   * Allocate one terminal session.
   *
   * The provider MUST either resolve a live session or reject having already
   * released everything it allocated: the registry publishes a session only
   * after this resolves, so a rejection that left a process running would be
   * unreachable by every later operation.
   * @param spec - registry-minted identity and the requested terminal dimensions.
   * @returns the live provider session.
   */
  open(spec: InteractiveTerminalOpenSpec): Promise<InteractiveTerminalBackendSession>
}
```

A terminal's output belongs to exactly one generation: two emulators over one byte stream would each see a different, corrupt terminal, so a second `frames` call fails with `OUTPUT_ACTIVE` and the slot is released when the generation's signal aborts. Output produced between `open` and the first pull is retained in a bounded queue, which is what makes the identity-then-stream sequence safe; once retained bytes reach the configured budget the producer waits, so a stalled consumer cannot grow Host memory through this queue.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinteractiveterminals--interactiveterminalservice"></a>

### `ctx.interactiveTerminals` — `InteractiveTerminalService`

In-process registry for replaceable interactive-terminal providers and session-scoped terminals.

```ts cordis-catalog
/**
 * Register one provider type for this effect scope.
 * @param provider - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerProvider(provider: InteractiveTerminalProvider): () => void

/**
 * List registered provider types in registration order.
 * @returns fresh provider type names.
 */
listProviders(): string[]

/**
 * Allocate and publish one owner-scoped terminal after provider setup succeeds.
 * @param owner - Session that owns access and cleanup.
 * @param request - provider type, working directory, and initial dimensions.
 * @param signal - cancellation of unpublished provider setup.
 * @returns the published identity, provider type, process id, and status.
 */
async open( owner: SessionId, request: InteractiveTerminalOpenRequest, signal?: AbortSignal, ): Promise<InteractiveTerminalSnapshot>

/**
 * List fresh snapshots for exactly one Session.
 * @param owner - Session whose terminals are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: SessionId): InteractiveTerminalSnapshot[]

/**
 * Write bytes to one owned terminal's input.
 * @param owner - Session that owns the terminal.
 * @param id - target terminal identity.
 * @param data - text to deliver without implicit newline conversion.
 * @returns once the provider accepted the write.
 */
async write(owner: SessionId, id: InteractiveTerminalId, data: string): Promise<void>

/**
 * Change one owned terminal's window size.
 * @param owner - Session that owns the terminal.
 * @param id - target terminal identity.
 * @param cols - new column count.
 * @param rows - new row count.
 * @returns once the provider applied the size.
 */
async resize(owner: SessionId, id: InteractiveTerminalId, cols: number, rows: number): Promise<void>

/**
 * Follow one owned terminal's output.
 *
 * Exactly one generation may hold a terminal's output at a time, so a second
 * caller is a wiring mistake rather than a silent split of the byte stream.
 * @param owner - Session that owns the terminal.
 * @param id - target terminal identity.
 * @param signal - cancellation of this generation.
 * @returns retained and live frames in production order.
 */
frames(owner: SessionId, id: InteractiveTerminalId, signal: AbortSignal): AsyncIterable<InteractiveTerminalFrame>

/**
 * Close one owned terminal and remove it only after quiescent provider cleanup.
 * @param owner - Session that owns the terminal.
 * @param id - target terminal identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed terminal, false when the same close is already in flight.
 */
async close(owner: SessionId, id: InteractiveTerminalId, reason: string = 'client request'): Promise<boolean>

/**
 * Close every terminal one Session owns, awaiting quiescence for each.
 * @param owner - Session whose terminals all close.
 * @param reason - diagnostic cleanup reason.
 * @returns once every terminal closed; rejects with every failure otherwise.
 */
async closeOwner(owner: SessionId, reason: string = 'session closed'): Promise<void>
```

Types: [SessionId](core.md)

Source: [`packages/terminal/terminal-interactive/src/index.ts`](../../packages/terminal/terminal-interactive/src/index.ts)

<a id="ctxterminalcontroller--terminalcontroller"></a>

### `ctx.terminalController` — `TerminalController`

Host Remote surface over `ctx.interactiveTerminals`.

```ts cordis-catalog
/**
 * Open one terminal in a Session's workspace.
 * @param request - owning Session and initial window size.
 * @param signal - cancellation of allocation.
 * @returns the new terminal's identity, process id, and status.
 */
@Remote async open(request: TerminalOpenRequest, signal: AbortSignal): Promise<TerminalSnapshot>

/**
 * List the live terminals one Session owns.
 * @param request - Session whose terminals are listed.
 * @returns owner-visible snapshots in publication order.
 */
@Remote list(request: TerminalListRequest): TerminalSnapshot[]

/**
 * Deliver input bytes to one terminal.
 * @param request - target terminal and the text to deliver.
 * @param signal - cancellation of the provider write.
 */
@Remote async write(request: TerminalWriteRequest, signal: AbortSignal): Promise<void>

/**
 * Change one terminal's window size.
 * @param request - target terminal and its new dimensions.
 * @param signal - cancellation of the provider resize.
 */
@Remote async resize(request: TerminalResizeRequest, signal: AbortSignal): Promise<void>

/**
 * Close one terminal after awaited provider cleanup.
 * @param request - the terminal to close.
 * @param signal - cancellation of the provider cleanup.
 * @returns whether this call performed the close.
 */
@Remote async close(request: TerminalTarget, signal: AbortSignal): Promise<TerminalCloseResult>

/**
 * Follow one terminal's output for the life of this generation.
 * @param request - the terminal to follow.
 * @param signal - generation cancellation; the seam releases the terminal's consumer slot either way.
 * @returns retained and live frames, base64-encoded in production order.
 */
@Remote({ mode: 'stream' }) output(request: TerminalTarget, signal: AbortSignal): AsyncIterable<TerminalFrame>
```

Source: [`packages/api/terminal-controller/src/index.ts`](../../packages/api/terminal-controller/src/index.ts)

<a id="ctxterminals--terminalsessionservice"></a>

### `ctx.terminals` — `TerminalSessionService`

In-process registry for replaceable PTY backends and exact-Agent sessions.

```ts cordis-catalog
/**
 * Register one backend type for this effect scope.
 * @param backend - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerBackend(backend: TerminalBackend): () => void

/**
 * List registered backend types in registration order.
 * @returns fresh backend type names.
 */
listBackends(): string[]

/**
 * Create and publish one owner-scoped session after backend setup succeeds.
 * @param owner - exact registered Agent that owns access and cleanup.
 * @param request - backend type plus optional owner-local name and cwd.
 * @param signal - cancellation of unpublished setup.
 * @returns published identity, metadata, status, and MOTD.
 */
async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>

/**
 * Test whether an exact owner has a published session or unpublished spawn.
 * @param owner - exact live owner to inspect.
 * @returns true across the entire spawn-to-close interval, with no publication gap.
 */
hasOwnerActivity(owner: Agent): boolean

/**
 * Start one exclusive interactive send.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - explicit text, submit behavior, and cancellation.
 * @returns live operation handle for foreground await or task registration.
 */
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation

/**
 * Read one bounded scrollback page from an owned session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - optional newest-relative offset and line count.
 * @returns bounded retained text and pagination metadata.
 */
read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult

/**
 * Deliver an allowed signal through an owned backend session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param signal - allowed POSIX signal name.
 * @returns delivered foreground process-group identity.
 */
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>

/**
 * Close one owned session and remove it only after quiescent backend cleanup.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed session, false when the same close is already in flight.
 */
async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>

/**
 * List fresh snapshots for exactly one owner.
 * @param owner - exact owner whose sessions are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: Agent): TerminalSessionSnapshot[]
```

Types: [Agent](core.md)

Source: [`packages/terminal/terminal/src/index.ts`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
