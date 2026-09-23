import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import InteractiveTerminalService from '@deepseek-ai/dsh-terminal-interactive'
import type {
  InteractiveTerminalBackendSession,
  InteractiveTerminalOpenSpec,
  InteractiveTerminalProvider,
  InteractiveTerminalStatus,
} from '@deepseek-ai/dsh-terminal-interactive'
import TerminalController from '@deepseek-ai/dsh-api-terminal-controller'
import type { TerminalTarget } from '@deepseek-ai/dsh-api-terminal-controller'

/** One provider session whose output and status the test drives directly. */
class StubSession implements InteractiveTerminalBackendSession {
  readonly writes: string[] = []
  readonly resizes: { cols: number; rows: number }[] = []
  readonly output: AsyncIterable<Uint8Array>
  statusValue: InteractiveTerminalStatus = { kind: 'running' }
  private readonly emitChunk: (data: Uint8Array) => void
  private readonly endOutput: () => void

  constructor(readonly pid: number | undefined) {
    const pending: Uint8Array[] = []
    let wake: (() => void) | undefined
    let ended = false
    const release = (): void => {
      const waiting = wake
      wake = undefined
      waiting?.()
    }
    this.emitChunk = (data) => { pending.push(data); release() }
    this.endOutput = () => { ended = true; release() }
    this.output = (async function * (): AsyncGenerator<Uint8Array> {
      for (;;) {
        while (pending.length > 0) yield pending.shift() as Uint8Array
        if (ended) return
        await new Promise<void>((resolve) => { wake = resolve })
      }
    })()
  }

  /** Publish one output chunk to the registry's drain loop. */
  emit(data: Uint8Array): void {
    this.emitChunk(data)
  }

  async write(data: string): Promise<void> {
    this.writes.push(data)
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.resizes.push({ cols, rows })
  }

  status(): InteractiveTerminalStatus {
    return this.statusValue
  }

  async close(): Promise<void> {
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    this.endOutput()
  }
}

/** One provider handing back a single drivable session. */
class StubProvider implements InteractiveTerminalProvider {
  readonly specs: InteractiveTerminalOpenSpec[] = []
  session: StubSession | undefined

  constructor(readonly type = 'shell', private readonly pid?: number) {}

  async open(spec: InteractiveTerminalOpenSpec): Promise<InteractiveTerminalBackendSession> {
    this.specs.push(spec)
    this.session = new StubSession(this.pid)
    return this.session
  }
}

async function harness(options: { pid?: number | undefined } = {}): Promise<{
  controller: TerminalController
  provider: StubProvider
}> {
  const ctx = new Context()
  await ctx.plugin(InteractiveTerminalService, { maxBufferedBytes: 1024 })
  const provider = new StubProvider('shell', 'pid' in options ? options.pid : 99)
  ctx.interactiveTerminals.registerProvider(provider)
  return { controller: new TerminalController(ctx, { type: 'shell' }), provider }
}

const owner = SessionId('session-1')
const signal = new AbortController().signal

/** Collect every frame a terminal stream yields. */
async function consume(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const seen: unknown[] = []
  for await (const frame of stream) seen.push(frame)
  return seen
}

describe('TerminalController Remote surface', () => {
  it('opens a terminal through the seam and reports it on the wire', async () => {
    const { controller, provider } = await harness()
    const snapshot = await controller.open({ sessionId: owner, cols: 100, rows: 30 }, signal)

    expect(snapshot).toEqual({ terminalId: 'iterm-1', pid: 99, status: { kind: 'running' } })
    expect(provider.specs[0]).toMatchObject({ type: 'shell', cols: 100, rows: 30, owner: 'session-1' })
    expect(controller.list({ sessionId: owner })).toEqual([snapshot])
  })

  it('omits the process id for a provider that has none', async () => {
    const { controller } = await harness({ pid: undefined })
    const snapshot = await controller.open({ sessionId: owner, cols: 80, rows: 24 }, signal)
    expect(snapshot).toEqual({ terminalId: 'iterm-1', status: { kind: 'running' } })
    expect(controller.list({ sessionId: owner })).toEqual([snapshot])
  })

  it('routes writes, resizes, and closes through the seam', async () => {
    const { controller, provider } = await harness()
    const { terminalId } = await controller.open({ sessionId: owner, cols: 100, rows: 30 }, signal)
    const target: TerminalTarget = { sessionId: owner, terminalId }

    await controller.write({ ...target, data: 'ls\r' }, signal)
    await controller.resize({ ...target, cols: 120, rows: 40 }, signal)
    expect(provider.session?.writes).toEqual(['ls\r'])
    expect(provider.session?.resizes).toEqual([{ cols: 120, rows: 40 }])

    await expect(controller.close(target, signal)).resolves.toEqual({ closed: true })
    await expect(controller.close(target, signal)).rejects.toMatchObject({ code: 'NO_TERMINAL' })
  })

  it('encodes raw terminal bytes as base64 on the stream', async () => {
    const { controller, provider } = await harness()
    const { terminalId } = await controller.open({ sessionId: owner, cols: 100, rows: 30 }, signal)
    const target: TerminalTarget = { sessionId: owner, terminalId }

    const consuming = consume(controller.output(target, new AbortController().signal))
    provider.session?.emit(Buffer.from('\u001b[32mok\u001b[0m', 'utf8'))
    await provider.session?.close()

    expect(await consuming).toEqual([
      { kind: 'output', data: Buffer.from('\u001b[32mok\u001b[0m', 'utf8').toString('base64') },
      { kind: 'exit', status: { kind: 'exited', exitCode: 0, signal: null } },
    ])
  })

  it('refuses an operation whose signal is already aborted', async () => {
    const { controller } = await harness()
    const aborted = new AbortController()
    aborted.abort(new Error('cancelled'))
    const target: TerminalTarget = { sessionId: owner, terminalId: 'iterm-1' }
    await expect(controller.write({ ...target, data: 'x' }, aborted.signal)).rejects.toThrow('cancelled')
    await expect(controller.resize({ ...target, cols: 1, rows: 1 }, aborted.signal)).rejects.toThrow('cancelled')
    await expect(controller.close(target, aborted.signal)).rejects.toThrow('cancelled')
  })
})
