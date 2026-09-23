/**
 * The terminal tab's asynchronous half: the `terminals` Remote calls the body
 * makes.
 *
 * The component never reaches the Remote itself. It calls these callbacks, and
 * each one names the Session and the terminal it acts on, so one injected face
 * serves every terminal tab in every Session. Presence and write are
 * fire-and-forget: the body already reflects the user's keystroke in its
 * emulator, and a refused write surfaces as the stream ending, not as a
 * rejected promise nobody awaits.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TerminalFrame, TerminalSnapshot } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The slice of the Client Remote this package calls, as the generated namespace declares it. */
export type TerminalRemote = { readonly terminals: ClientRemote['terminals'] }

/**
 * The terminal tab's injected business face, as the body receives it. Every
 * callback already belongs to the Session the factory was built for.
 */
export interface TerminalInjected {
  /**
   * Allocate one terminal in this Session's workspace.
   * @param cols - initial column count.
   * @param rows - initial row count.
   * @param signal - cancellation of allocation.
   * @returns the new terminal, or the failure that refused it.
   */
  readonly open: (cols: number, rows: number, signal: AbortSignal) => Promise<RemoteResult<TerminalSnapshot>>
  /**
   * Deliver input to one terminal.
   * @param terminalId - target terminal identity.
   * @param data - text to deliver without implicit newline conversion.
   */
  readonly write: (terminalId: string, data: string) => void
  /**
   * Change one terminal's window size.
   * @param terminalId - target terminal identity.
   * @param cols - new column count.
   * @param rows - new row count.
   */
  readonly resize: (terminalId: string, cols: number, rows: number) => void
  /**
   * Close one terminal and wait for nothing: the Host cleans up on its own.
   * @param terminalId - target terminal identity.
   */
  readonly close: (terminalId: string) => void
  /**
   * Follow one terminal's output.
   * @param terminalId - target terminal identity.
   * @param signal - the tab record's lifetime.
   * @returns bare frames; the stream does not carry a `RemoteResult` envelope.
   */
  readonly output: (terminalId: string, signal: AbortSignal) => AsyncIterable<TerminalFrame>
}

/**
 * Bind the tab's face to one Remote face.
 *
 * The returned factory is the Slot `inject` shape: the framework supplies the
 * Session the tab is in, and every callback below acts inside it.
 * @param remote - the Client Remote carrying the `terminals` namespace.
 * @returns the factory producing the face the body receives.
 */
export function terminalFace(remote: TerminalRemote): (sessionId: SessionId) => TerminalInjected {
  return (sessionId: SessionId): TerminalInjected => ({
    open: async (cols, rows, signal) => await remote.terminals.open({ sessionId, cols, rows }, signal),
    write: (terminalId, data) => { void remote.terminals.write({ sessionId, terminalId, data }) },
    resize: (terminalId, cols, rows) => { void remote.terminals.resize({ sessionId, terminalId, cols, rows }) },
    close: (terminalId) => { void remote.terminals.close({ sessionId, terminalId }) },
    output: (terminalId, signal) => remote.terminals.output({ sessionId, terminalId }, signal),
  })
}
