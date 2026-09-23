/**
 * One local interactive terminal over the subprocess terminal primitive.
 *
 * The session is a thin adapter: the provider's `SubprocessTerminalHandle`
 * already owns the controlling terminal, raw byte output, input, resize, and
 * whole-session quiescence, so this type only maps those onto the
 * interactive-terminal session contract and remembers the process outcome.
 */

import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { InteractiveTerminalBackendSession, InteractiveTerminalStatus } from '@deepseek-ai/dsh-terminal-interactive'

/** Backend session wrapping one provider-owned terminal process. */
export class LocalInteractiveSession implements InteractiveTerminalBackendSession {
  readonly pid: number
  readonly output: AsyncIterable<Uint8Array>
  private statusValue: InteractiveTerminalStatus = { kind: 'running' }
  private closePromise: Promise<void> | undefined

  /** @param terminal - live terminal-process handle owned by the subprocess provider. */
  constructor(private readonly terminal: SubprocessTerminalHandle) {
    this.pid = terminal.pid
    this.output = terminal.output
    void terminal.done.then(
      (outcome) => { this.statusValue = { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal } },
      // A provider or transport failure means the top-level process is gone
      // without a reportable exit fact; both fields stay unknown.
      () => { this.statusValue = { kind: 'exited', exitCode: null, signal: null } },
    )
  }

  /** @inheritdoc */
  async write(data: string): Promise<void> {
    await this.terminal.write(data)
  }

  /** @inheritdoc */
  async resize(cols: number, rows: number): Promise<void> {
    await this.terminal.resize(cols, rows)
  }

  /** @inheritdoc */
  status(): InteractiveTerminalStatus {
    return this.statusValue
  }

  /** @inheritdoc */
  close(reason: string): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    const closing = this.terminal.terminate().catch((error: unknown) => {
      this.closePromise = undefined
      throw new Error(`interactive terminal cleanup failed (${reason})`, { cause: error })
    })
    this.closePromise = closing
    return closing
  }
}
