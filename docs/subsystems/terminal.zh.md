# 终端

[English](terminal.md) | 中文

终端由两个彼此独立的 seam 提供。`ctx.terminals` 让面向模型的 PTY 会话跨工具调用保持存活：其类型来自 [`packages/terminal/terminal/src/types.ts`](../../packages/terminal/terminal/src/types.ts)，决策依据由[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.zh.md) 负责。`ctx.interactiveTerminals` 则分配由人通过浏览器直接操作的原始终端，其类型来自 [`packages/terminal/terminal-interactive/src/types.ts`](../../packages/terminal/terminal-interactive/src/types.ts)。

## 标识与就绪

`TerminalSessionId` 是由服务铸造的branded id。可选名称是拥有者本地的显示元数据；授权比较的是拥有该会话的确切 `Agent`，而不是名称或猜测的 id。

`TerminalWaitReason` 说明一次发送为何返回。它与 `TerminalSessionStatus` 无关：一次发送可能因静默或超时而返回，但顶层 shell 仍然存活；`session_exit` 表示该 shell 已退出，而不是某个任意的前台子进程已退出。

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

## 后端与活跃会话

后端负责启动某种已注册类型的会话并检测其就绪状态。`TerminalSessionService` 只在初始化成功后才发布返回的会话，随后负责 id 授权与清理。无法清理部分启动资源时，后端会以 `TerminalBackendCleanupError` 拒绝启动；这样，资源释放流程既能保留清理失败，也不会用它替换调用方的取消原因。后端会话拥有终端状态，并负责让已捕获的资源完全停稳。

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

## 发送与保留输出

一个活跃会话同时只接受一个活动发送。该操作向通用后台任务提供读取后即推进的输出游标，并向前台调用方提供最终结果。`TerminalReadResult` 则为有界的会话 scrollback 单独分页。

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

## 归属与持久性

`TerminalSessionService` 会将一项等待完成的清理附加到确切的拥有者作用域，拒绝其他拥有者的操作，并让会话在后端或工具插件重载期间保持存活。PTY 状态与原始字节仍局限在进程内。模型输入与有界返回输出通过现有 `tool/call`、`tool/result` 和任务结果路径持久保存，而不是重复记录 PTY 会话事件。

## 交互式终端

`InteractiveTerminalService` 服务于由人直接操作的终端：它铸造不透明终端 ID，将分配路由到已注册的 `InteractiveTerminalProvider` 类型，保留消费方接入之前产生的输出，并等待清理静默完成。它的隔离依据是拥有该终端的确切 `Session`，而不是 `Agent`；它既不渲染文本也不跟踪就绪状态——消费方是终端模拟器，因此流携带原始字节，屏幕如何呈现由消费方决定。

两个 seam 保持分离，是因为它们的约定无法共用一个 Context key：`ctx.terminals` 由 Agent 拥有、按行交互，并返回净化后的渲染文本；而浏览器 UI 没有 `Agent`，需要模拟器消费的字节，也需要窗口尺寸变更。`ctx.terminalController` 是交互式 seam 之上的 Remote 接口，以 `terminals` 命名空间把它带给浏览器。

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

一个终端的输出只属于一个 generation：两个模拟器共享同一条字节流时，各自看到的会是不同且已损坏的终端，因此第二次 `frames` 调用会以 `OUTPUT_ACTIVE` 失败，而该 generation 的 signal 中止时槽位即被释放。`open` 与首次拉取之间产生的输出会被保留在有界队列中，这正是“先取身份、再开流”这一顺序安全的原因；一旦保留字节达到配置的预算，生产方就会等待，因此停滞的消费方无法通过该队列增长 Host 内存。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

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

Types: [Agent](core.zh.md)

Source: [`packages/terminal/terminal/src/index.ts`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
