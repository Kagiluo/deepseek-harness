/**
 * Session-scoped registry for interactive terminals. Providers own substrate
 * mechanics while this service owns ids, publication, owner authorization,
 * output retention, and awaited cleanup.
 *
 * This seam is deliberately separate from `ctx.terminals`: that service serves
 * the model with line-oriented sends and rendered text under an exact `Agent`
 * owner, while a terminal emulator on the Client needs the raw byte stream, a
 * window size, and a `Session` owner. Sharing one contract would force each
 * consumer to satisfy the other's requirements.
 * @module @deepseek-ai/dsh-terminal-interactive
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FrameBuffer } from './buffer.ts'
import type {
  InteractiveTerminalBackendSession,
  InteractiveTerminalFrame,
  InteractiveTerminalIdValue,
  InteractiveTerminalOpenRequest,
  InteractiveTerminalProvider,
  InteractiveTerminalSnapshot,
  InteractiveTerminalStatus,
} from './types.ts'

export type {
  InteractiveTerminalBackendSession,
  InteractiveTerminalFrame,
  InteractiveTerminalIdValue,
  InteractiveTerminalOpenRequest,
  InteractiveTerminalOpenSpec,
  InteractiveTerminalProvider,
  InteractiveTerminalSnapshot,
  InteractiveTerminalStatus,
} from './types.ts'

/** Opaque identity minted by {@link InteractiveTerminalService} for one live terminal. */
export type InteractiveTerminalId = InteractiveTerminalIdValue

declare module '@deepseek-ai/cordis' {
  interface Context {
    interactiveTerminals: InteractiveTerminalService
  }
}

/**
 * Brand one registry-minted string as an {@link InteractiveTerminalId}.
 * @param value - raw registry-issued id.
 * @returns the same string carrying the interactive-terminal brand.
 */
export function InteractiveTerminalId(value: string): InteractiveTerminalId {
  return value as InteractiveTerminalId
}

/** Machine-routable interactive-terminal failures. */
export type InteractiveTerminalErrorCode =
  | 'DUPLICATE_PROVIDER'
  | 'FOREIGN_TERMINAL'
  | 'NO_PROVIDER'
  | 'NO_TERMINAL'
  | 'OUTPUT_ACTIVE'
  | 'SERVICE_DISPOSING'

/** Error carrying a stable {@link InteractiveTerminalErrorCode}. */
export class InteractiveTerminalError extends Error {
  constructor(message: string, readonly code: InteractiveTerminalErrorCode) {
    super(message)
    this.name = 'InteractiveTerminalError'
  }
}

/** Deployment bounds for output retained ahead of its consumer. */
export interface Config {
  /** Inclusive byte budget for one terminal's retained output. */
  readonly maxBufferedBytes: number
}

interface TerminalRecord {
  readonly terminalId: InteractiveTerminalId
  readonly owner: SessionId
  readonly type: string
  readonly session: InteractiveTerminalBackendSession
  readonly buffer: FrameBuffer
  status: InteractiveTerminalStatus
  closing: Promise<void> | undefined
  /** The loop consuming the provider's output; cleared once it completes. */
  drain: Promise<void> | undefined
}

/** Human-readable text for a provider or transport failure. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** In-process registry for replaceable interactive-terminal providers and session-scoped terminals. */
export class InteractiveTerminalService extends Service {
  private readonly providers = new Map<string, InteractiveTerminalProvider>()
  private readonly terminals = new Map<InteractiveTerminalId, TerminalRecord>()
  private nextId = 0
  private disposing = false

  static Config: z<Config> = z.object({
    maxBufferedBytes: z.number().step(1).min(1).default(1024 * 1024),
  })

  /**
   * @param ctx - Host context owning this service's lifetime.
   * @param config - deployment bound on retained output.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'interactiveTerminals')
    ctx.effect(() => () => this.disposeAll(), 'interactive terminals teardown')
  }

  /**
   * Register one provider type for this effect scope.
   * @param provider - provider with a non-empty unique type.
   * @returns disposer that removes exactly this contribution.
   */
  registerProvider(provider: InteractiveTerminalProvider): () => void {
    if (provider.type.length === 0) throw new Error('interactive terminal provider type must be non-empty')
    if (this.providers.has(provider.type)) {
      throw new InteractiveTerminalError(
        `an interactive terminal provider named "${provider.type}" is already registered`,
        'DUPLICATE_PROVIDER',
      )
    }
    const dispose = this.ctx.effect(() => {
      this.providers.set(provider.type, provider)
      return () => {
        if (this.providers.get(provider.type) === provider) this.providers.delete(provider.type)
      }
    }, 'interactiveTerminals.registerProvider()')
    return () => void dispose()
  }

  /**
   * List registered provider types in registration order.
   * @returns fresh provider type names.
   */
  listProviders(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Allocate and publish one owner-scoped terminal after provider setup succeeds.
   * @param owner - Session that owns access and cleanup.
   * @param request - provider type, working directory, and initial dimensions.
   * @param signal - cancellation of unpublished provider setup.
   * @returns the published identity, provider type, process id, and status.
   */
  async open(
    owner: SessionId,
    request: InteractiveTerminalOpenRequest,
    signal?: AbortSignal,
  ): Promise<InteractiveTerminalSnapshot> {
    this.assertActive()
    signal?.throwIfAborted()
    const provider = this.providers.get(request.type)
    if (provider === undefined) {
      throw new InteractiveTerminalError(
        `no interactive terminal provider registered for "${request.type}"`,
        'NO_PROVIDER',
      )
    }
    const terminalId = InteractiveTerminalId(`iterm-${++this.nextId}`)
    const session = await provider.open({ ...request, terminalId, owner, ...signal === undefined ? {} : { signal } })
    // Nothing may publish a terminal into a service that is already tearing
    // down, and a cancelled open must not leave the provider's process behind.
    if (this.disposing) {
      await session.close('interactive terminal service is disposing')
      throw new InteractiveTerminalError('interactive terminal service is disposing', 'SERVICE_DISPOSING')
    }
    if (signal?.aborted === true) {
      await session.close('interactive terminal open was cancelled')
      signal.throwIfAborted()
    }
    const record: TerminalRecord = {
      terminalId,
      owner,
      type: request.type,
      session,
      buffer: new FrameBuffer(this.config.maxBufferedBytes),
      status: session.status(),
      closing: undefined,
      drain: undefined,
    }
    this.terminals.set(terminalId, record)
    record.drain = this.drain(record)
    return this.snapshot(record)
  }

  /**
   * List fresh snapshots for exactly one Session.
   * @param owner - Session whose terminals are visible.
   * @returns owner-visible snapshots in publication order.
   */
  list(owner: SessionId): InteractiveTerminalSnapshot[] {
    return [...this.terminals.values()]
      .filter(record => record.owner === owner)
      .map(record => this.snapshot(record))
  }

  /**
   * Write bytes to one owned terminal's input.
   * @param owner - Session that owns the terminal.
   * @param id - target terminal identity.
   * @param data - text to deliver without implicit newline conversion.
   * @returns once the provider accepted the write.
   */
  async write(owner: SessionId, id: InteractiveTerminalId, data: string): Promise<void> {
    const record = this.expectOwned(owner, id)
    if (record.closing !== undefined) throw new Error(`interactive terminal ${id} is closing`)
    await record.session.write(data)
  }

  /**
   * Change one owned terminal's window size.
   * @param owner - Session that owns the terminal.
   * @param id - target terminal identity.
   * @param cols - new column count.
   * @param rows - new row count.
   * @returns once the provider applied the size.
   */
  async resize(owner: SessionId, id: InteractiveTerminalId, cols: number, rows: number): Promise<void> {
    const record = this.expectOwned(owner, id)
    if (record.closing !== undefined) throw new Error(`interactive terminal ${id} is closing`)
    if (!Number.isSafeInteger(cols) || cols <= 0) throw new Error('interactive terminal cols must be a positive safe integer')
    if (!Number.isSafeInteger(rows) || rows <= 0) throw new Error('interactive terminal rows must be a positive safe integer')
    await record.session.resize(cols, rows)
  }

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
  frames(owner: SessionId, id: InteractiveTerminalId, signal: AbortSignal): AsyncIterable<InteractiveTerminalFrame> {
    const record = this.expectOwned(owner, id)
    if (!record.buffer.acquire()) {
      throw new InteractiveTerminalError(
        `interactive terminal ${id} already has an active output stream`,
        'OUTPUT_ACTIVE',
      )
    }
    return this.consume(record, signal)
  }

  /**
   * Close one owned terminal and remove it only after quiescent provider cleanup.
   * @param owner - Session that owns the terminal.
   * @param id - target terminal identity.
   * @param reason - diagnostic cleanup reason.
   * @returns true for a newly closed terminal, false when the same close is already in flight.
   */
  async close(owner: SessionId, id: InteractiveTerminalId, reason: string = 'client request'): Promise<boolean> {
    const record = this.expectOwned(owner, id)
    if (record.closing !== undefined) {
      await record.closing
      return false
    }
    const closing = record.session.close(reason)
    record.closing = closing
    try {
      await closing
      await record.drain
      this.terminals.delete(id)
      return true
    } catch (error: unknown) {
      record.closing = undefined
      throw error
    }
  }

  /**
   * Close every terminal one Session owns, awaiting quiescence for each.
   * @param owner - Session whose terminals all close.
   * @param reason - diagnostic cleanup reason.
   * @returns once every terminal closed; rejects with every failure otherwise.
   */
  async closeOwner(owner: SessionId, reason: string = 'session closed'): Promise<void> {
    const ids = [...this.terminals.values()]
      .filter(record => record.owner === owner)
      .map(record => record.terminalId)
    const results = await Promise.allSettled(ids.map(async (id) => { await this.close(owner, id, reason) }))
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map<unknown>(result => result.reason as unknown)
    if (failures.length > 0) {
      throw new AggregateError(failures, `failed to close ${failures.length} interactive terminal(s)`)
    }
  }

  /** Follow one terminal's frames while this generation holds its consumer slot. */
  private async *consume(record: TerminalRecord, signal: AbortSignal): AsyncGenerator<InteractiveTerminalFrame> {
    try {
      yield* record.buffer.iterate(signal)
    } finally {
      record.buffer.release()
    }
  }

  /**
   * Consume the provider's output for one terminal's whole life.
   *
   * The loop is the terminal's producer: it runs from publication until the
   * provider's output ends, retaining frames whether or not a consumer is
   * attached. Its last act is the terminal outcome, so a consumer that arrives
   * after the process exited still learns how it ended.
   */
  private async drain(record: TerminalRecord): Promise<void> {
    let failure: unknown
    try {
      for await (const chunk of record.session.output) {
        await record.buffer.push({ kind: 'output', data: chunk })
      }
    } catch (error: unknown) {
      failure = error
    }
    record.status = record.session.status()
    await record.buffer.push(failure === undefined
      ? { kind: 'exit', status: record.status }
      : { kind: 'failed', message: failureText(failure) })
    record.buffer.close()
    record.drain = undefined
  }

  private snapshot(record: TerminalRecord): InteractiveTerminalSnapshot {
    return {
      terminalId: record.terminalId,
      type: record.type,
      ...record.session.pid === undefined ? {} : { pid: record.session.pid },
      status: record.status,
    }
  }

  private expectOwned(owner: SessionId, id: InteractiveTerminalId): TerminalRecord {
    const record = this.terminals.get(id)
    if (record === undefined) throw new InteractiveTerminalError(`unknown interactive terminal ${id}`, 'NO_TERMINAL')
    if (record.owner !== owner) {
      throw new InteractiveTerminalError(`interactive terminal ${id} belongs to another session`, 'FOREIGN_TERMINAL')
    }
    return record
  }

  private assertActive(): void {
    if (this.disposing) {
      throw new InteractiveTerminalError('interactive terminal service is disposing', 'SERVICE_DISPOSING')
    }
  }

  private async disposeAll(): Promise<void> {
    this.disposing = true
    const owners = [...new Set([...this.terminals.values()].map(record => record.owner))]
    const results = await Promise.allSettled(owners.map(async (owner) => {
      await this.closeOwner(owner, 'interactive terminal service disposed')
    }))
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map<unknown>(result => result.reason as unknown)
    this.providers.clear()
    if (failures.length > 0) {
      throw new AggregateError(failures, `failed to close ${failures.length} interactive terminal owner(s)`)
    }
  }
}

export default InteractiveTerminalService
