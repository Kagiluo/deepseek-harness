/**
 * Types shared by interactive-terminal providers and the session-scoped
 * registry. Runtime service code lives in `./index.ts`.
 * @module @deepseek-ai/dsh-terminal-interactive/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Internal exported basis for the public `InteractiveTerminalId` type/value pair. */
export type InteractiveTerminalIdValue = Branded<'InteractiveTerminalId'>

/** Top-level terminal process status, independent of the frame that carried it. */
export type InteractiveTerminalStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }

/**
 * One frame of a terminal's live stream.
 *
 * The stream carries raw bytes rather than rendered text because its consumer
 * is a terminal emulator on the Client: escape sequences, cursor movement, and
 * partial UTF-8 sequences must survive the wire exactly as the shell wrote them.
 */
export type InteractiveTerminalFrame =
  | { readonly kind: 'output'; readonly data: Uint8Array }
  /** The terminal substrate failed; the stream yields this frame once and then completes. */
  | { readonly kind: 'failed'; readonly message: string }
  /** The top-level process ended; the stream yields this frame once and then completes. */
  | { readonly kind: 'exit'; readonly status: InteractiveTerminalStatus }

/** Request to open one interactive terminal. */
export interface InteractiveTerminalOpenRequest {
  /** Registered provider type. */
  readonly type: string
  /** Working directory the terminal process starts in; omitted, the provider uses its execution policy's root. */
  readonly cwd?: string | undefined
  /** Initial column count. */
  readonly cols: number
  /** Initial row count. */
  readonly rows: number
}

/** Fully identified request handed from the registry to a provider. */
export interface InteractiveTerminalOpenSpec extends InteractiveTerminalOpenRequest {
  /** Registry-minted terminal identity. */
  readonly terminalId: InteractiveTerminalIdValue
  /** Session identity that owns the terminal; the provider resolves execution policy from it. */
  readonly owner: SessionId
  /** Cancellation of unpublished provider setup. */
  readonly signal?: AbortSignal | undefined
}

/** Owner-visible summary of one live interactive terminal. */
export interface InteractiveTerminalSnapshot {
  /** Registry-minted identity used by every operation. */
  readonly terminalId: InteractiveTerminalIdValue
  /** Provider type that created the terminal. */
  readonly type: string
  /** Top-level process id when the provider has one. */
  readonly pid?: number | undefined
  /** Current top-level process status. */
  readonly status: InteractiveTerminalStatus
}

/**
 * Provider-owned live terminal.
 *
 * The provider hands over raw substrate access and nothing else: readiness
 * detection, output retention, identity, authorization, and teardown ordering
 * belong to the registry and its consumers.
 */
export interface InteractiveTerminalBackendSession {
  /** Top-level process id when the provider has one. */
  readonly pid?: number | undefined
  /** Raw terminal output bytes in delivery order; ends after queued output once the terminal exits. */
  readonly output: AsyncIterable<Uint8Array>
  /**
   * Write bytes to the terminal input.
   * @param data - text to deliver without implicit newline conversion.
   */
  write(data: string): Promise<void>
  /**
   * Change the terminal's window size.
   * @param cols - new column count.
   * @param rows - new row count.
   */
  resize(cols: number, rows: number): Promise<void>
  /** Observe top-level process status. */
  status(): InteractiveTerminalStatus
  /** Idempotently release every resource the terminal captured and await quiescence. */
  close(reason: string): Promise<void>
}

/** Replaceable provider for one interactive terminal type. */
export interface InteractiveTerminalProvider {
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
