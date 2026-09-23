/**
 * Wire values for the `terminals` Remote namespace.
 *
 * Raw terminal bytes cross the wire base64-encoded: a JSON carrier has no byte
 * string, and an escape sequence must survive unchanged for the Client's
 * emulator to draw what the shell wrote.
 * @module @deepseek-ai/dsh-api-terminal-controller/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Top-level terminal process status as the Client sees it. A signal is the
 * platform's name for it (`SIGTERM`), which is the form a browser can print.
 */
export type TerminalWireStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null }

/** One live terminal as the Client sees it. */
export interface TerminalSnapshot {
  /** Host-minted identity used by every later operation. */
  readonly terminalId: string
  /** Top-level process id when the provider has one. */
  readonly pid?: number
  /** Current top-level process status. */
  readonly status: TerminalWireStatus
}

/** One frame of a terminal's live stream. */
export type TerminalFrame =
  | { readonly kind: 'output'; readonly data: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'exit'; readonly status: TerminalWireStatus }

/** Open one terminal inside the named Session. */
export interface TerminalOpenRequest {
  /** Session that owns the new terminal and selects its execution policy. */
  readonly sessionId: SessionId
  /** Terminal column count at open time. */
  readonly cols: number
  /** Terminal row count at open time. */
  readonly rows: number
}

/** Address one live terminal of one Session. */
export interface TerminalTarget {
  /** Session that owns the terminal. */
  readonly sessionId: SessionId
  /** Host-minted terminal identity. */
  readonly terminalId: string
}

/** Deliver input bytes to one terminal. */
export interface TerminalWriteRequest extends TerminalTarget {
  /** Text to deliver without implicit newline conversion. */
  readonly data: string
}

/** Change one terminal's window size. */
export interface TerminalResizeRequest extends TerminalTarget {
  /** New column count. */
  readonly cols: number
  /** New row count. */
  readonly rows: number
}

/** Report one Session's live terminals. */
export interface TerminalListRequest {
  /** Session whose terminals are listed. */
  readonly sessionId: SessionId
}

/** The result of one close request. */
export interface TerminalCloseResult {
  /** True for a newly closed terminal, false when the same close was already in flight. */
  readonly closed: boolean
}
