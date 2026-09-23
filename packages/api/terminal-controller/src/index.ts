/**
 * Interactive terminal service over Typert Remote: the browser's one path to a
 * real shell in a Session's workspace.
 *
 * This package owns no terminal mechanics and no identity. It resolves the
 * Session identity a Client sends into the `ctx.interactiveTerminals` owner
 * key, translates raw bytes to the base64 the wire carries, and exposes the
 * terminal's stream as a Remote stream. Authorization is the seam's: an
 * operation naming another Session's terminal fails there.
 * @module @deepseek-ai/dsh-api-terminal-controller
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { InteractiveTerminalId } from '@deepseek-ai/dsh-terminal-interactive'
import type { InteractiveTerminalFrame } from '@deepseek-ai/dsh-terminal-interactive'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TerminalCloseResult,
  TerminalFrame,
  TerminalListRequest,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalSnapshot,
  TerminalTarget,
  TerminalWriteRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `terminals` Remote namespace. */
    terminalController: TerminalController
  }
}

/** Settings the Host owner of the `terminals` namespace reads from its row. */
export interface Config {
  /** Provider type every terminal opens under. */
  readonly type: string
}

/** Host Remote surface over `ctx.interactiveTerminals`. */
export class TerminalController extends TypertRemoteService {
  static inject = ['interactiveTerminals']

  static Config: z<Config> = z.object({
    type: z.string().default('shell'),
  })

  /**
   * @param ctx - Host context carrying the interactive terminal registry.
   * @param config - provider type every terminal opens under.
   */
  constructor(ctx: Context, private readonly config: Config) {
    // The wire namespace is `terminals` while the Cordis key is
    // `terminalController`: `ctx.terminals` is already the model-facing
    // persistent PTY seam, and one Context key cannot carry two declarations.
    // Both names stay literal here because the Typert analyzer reads them from
    // this call site.
    super(ctx, 'terminalController', { namespace: 'terminals' })
  }

  /**
   * Open one terminal in a Session's workspace.
   * @param request - owning Session and initial window size.
   * @param signal - cancellation of allocation.
   * @returns the new terminal's identity, process id, and status.
   */
  @Remote
  async open(request: TerminalOpenRequest, signal: AbortSignal): Promise<TerminalSnapshot> {
    const snapshot = await this.ctx.interactiveTerminals.open(request.sessionId, {
      type: this.config.type,
      cols: request.cols,
      rows: request.rows,
    }, signal)
    return {
      terminalId: snapshot.terminalId,
      ...snapshot.pid === undefined ? {} : { pid: snapshot.pid },
      status: snapshot.status,
    }
  }

  /**
   * List the live terminals one Session owns.
   * @param request - Session whose terminals are listed.
   * @returns owner-visible snapshots in publication order.
   */
  @Remote
  list(request: TerminalListRequest): TerminalSnapshot[] {
    return this.ctx.interactiveTerminals.list(request.sessionId).map(snapshot => ({
      terminalId: snapshot.terminalId,
      ...snapshot.pid === undefined ? {} : { pid: snapshot.pid },
      status: snapshot.status,
    }))
  }

  /**
   * Deliver input bytes to one terminal.
   * @param request - target terminal and the text to deliver.
   * @param signal - cancellation of the provider write.
   */
  @Remote
  async write(request: TerminalWriteRequest, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.ctx.interactiveTerminals.write(request.sessionId, InteractiveTerminalId(request.terminalId), request.data)
  }

  /**
   * Change one terminal's window size.
   * @param request - target terminal and its new dimensions.
   * @param signal - cancellation of the provider resize.
   */
  @Remote
  async resize(request: TerminalResizeRequest, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.ctx.interactiveTerminals.resize(
      request.sessionId,
      InteractiveTerminalId(request.terminalId),
      request.cols,
      request.rows,
    )
  }

  /**
   * Close one terminal after awaited provider cleanup.
   * @param request - the terminal to close.
   * @param signal - cancellation of the provider cleanup.
   * @returns whether this call performed the close.
   */
  @Remote
  async close(request: TerminalTarget, signal: AbortSignal): Promise<TerminalCloseResult> {
    signal.throwIfAborted()
    const closed = await this.ctx.interactiveTerminals.close(
      request.sessionId,
      InteractiveTerminalId(request.terminalId),
    )
    return { closed }
  }

  /**
   * Follow one terminal's output for the life of this generation.
   * @param request - the terminal to follow.
   * @param signal - generation cancellation; the seam releases the terminal's consumer slot either way.
   * @returns retained and live frames, base64-encoded in production order.
   */
  @Remote({ mode: 'stream' })
  output(request: TerminalTarget, signal: AbortSignal): AsyncIterable<TerminalFrame> {
    return this.encode(this.ctx.interactiveTerminals.frames(
      request.sessionId,
      InteractiveTerminalId(request.terminalId),
      signal,
    ))
  }

  /** Encode raw provider bytes into the base64 the wire carries. */
  private async *encode(frames: AsyncIterable<InteractiveTerminalFrame>): AsyncGenerator<TerminalFrame> {
    for await (const frame of frames) {
      yield frame.kind === 'output'
        ? { kind: 'output', data: Buffer.from(frame.data).toString('base64') }
        : frame
    }
  }
}

export default TerminalController
