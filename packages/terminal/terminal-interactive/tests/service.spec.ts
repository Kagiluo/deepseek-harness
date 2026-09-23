import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import InteractiveTerminalService, {
  InteractiveTerminalError,
  InteractiveTerminalId,
} from '@deepseek-ai/dsh-terminal-interactive'
import type {
  InteractiveTerminalBackendSession,
  InteractiveTerminalFrame,
  InteractiveTerminalOpenSpec,
  InteractiveTerminalProvider,
  InteractiveTerminalStatus,
} from '@deepseek-ai/dsh-terminal-interactive'

/** A deferred gate whose settlement carries no value. */
function gate(): PromiseWithResolvers<void> {
  return Promise.withResolvers()
}

/** One provider session whose output, write, resize, and close facts tests drive directly. */
class StubSession implements InteractiveTerminalBackendSession {
  readonly writes: string[] = []
  readonly resizes: { cols: number; rows: number }[] = []
  readonly closeReasons: string[] = []
  readonly output: AsyncIterable<Uint8Array>
  statusValue: InteractiveTerminalStatus = { kind: 'running' }
  closeFailure: Error | undefined
  closeGate: PromiseWithResolvers<void> | undefined
  private readonly emitChunk: (data: Uint8Array) => void
  private readonly endOutput: () => void
  private readonly failOutput: (error: unknown) => void

  constructor(readonly pid: number | undefined) {
    const pending: Uint8Array[] = []
    let wake: (() => void) | undefined
    let ended = false
    let failure: unknown
    const release = (): void => {
      const waiting = wake
      wake = undefined
      waiting?.()
    }
    this.emitChunk = (data) => { pending.push(data); release() }
    this.endOutput = () => { ended = true; release() }
    this.failOutput = (error) => { failure = error; ended = true; release() }
    this.output = (async function * (): AsyncGenerator<Uint8Array> {
      for (;;) {
        while (pending.length > 0) yield pending.shift() as Uint8Array
        if (failure !== undefined) throw failure
        if (ended) return
        await new Promise<void>((resolve) => { wake = resolve })
      }
    })()
  }

  /** Publish one output chunk to the consuming registry. */
  emit(text: string): void {
    this.emitChunk(Buffer.from(text, 'utf8'))
  }

  /** End the provider's output stream as a normal process exit does. */
  end(): void {
    this.endOutput()
  }

  /** End the provider's output stream with a transport failure. */
  crash(error: unknown): void {
    this.failOutput(error)
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

  async close(reason: string): Promise<void> {
    this.closeReasons.push(reason)
    if (this.closeGate !== undefined) await this.closeGate.promise
    if (this.closeFailure !== undefined) throw this.closeFailure
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    this.endOutput()
  }
}

/** One provider recording every open spec and handing back drivable sessions. */
class StubProvider implements InteractiveTerminalProvider {
  readonly specs: InteractiveTerminalOpenSpec[] = []
  readonly sessions: StubSession[] = []
  openGate: PromiseWithResolvers<void> | undefined
  openFailure: Error | undefined
  pid: number | undefined = 4242

  constructor(readonly type = 'stub') {}

  async open(spec: InteractiveTerminalOpenSpec): Promise<InteractiveTerminalBackendSession> {
    this.specs.push(spec)
    if (this.openGate !== undefined) await this.openGate.promise
    if (this.openFailure !== undefined) throw this.openFailure
    const session = new StubSession(this.pid)
    this.sessions.push(session)
    return session
  }

  /** The most recently opened provider session. */
  get latest(): StubSession {
    const session = this.sessions.at(-1)
    if (session === undefined) throw new Error('the provider has not opened a session')
    return session
  }
}

/** The provider session opened at one position; tests drive them in open order. */
function sessionAt(provider: StubProvider, index: number): StubSession {
  const session = provider.sessions[index]
  if (session === undefined) throw new Error(`the provider has not opened session ${index}`)
  return session
}

async function setup(maxBufferedBytes = 1024): Promise<{
  service: InteractiveTerminalService
  provider: StubProvider
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = await ctx.plugin(InteractiveTerminalService, { maxBufferedBytes })
  const service = ctx.interactiveTerminals
  const provider = new StubProvider()
  service.registerProvider(provider)
  return { service, provider, dispose: async () => { await fiber.dispose() } }
}

const owner = SessionId('session-1')
const other = SessionId('session-2')
const request = { type: 'stub', cwd: '/workspace', cols: 80, rows: 24 }

/** Collect every frame one stream yields. */
async function consume(stream: AsyncIterable<InteractiveTerminalFrame>): Promise<InteractiveTerminalFrame[]> {
  const seen: InteractiveTerminalFrame[] = []
  for await (const frame of stream) seen.push(frame)
  return seen
}

/** Collect every frame one terminal yields until its stream completes. */
async function frames(
  service: InteractiveTerminalService, id: InteractiveTerminalId, signal: AbortSignal,
): Promise<InteractiveTerminalFrame[]> {
  return await consume(service.frames(owner, id, signal))
}

describe('InteractiveTerminalService providers', () => {
  it('registers providers, lists them in order, and disposes exact contributions', async () => {
    const { service } = await setup()
    const second = new StubProvider('second')
    const dispose = service.registerProvider(second)
    expect(service.listProviders()).toEqual(['stub', 'second'])
    dispose()
    expect(service.listProviders()).toEqual(['stub'])

    // A contribution another registration already replaced stays in place when
    // the superseded disposer runs.
    const stale = new StubProvider('later')
    const disposeStale = service.registerProvider(stale)
    const internal = service as unknown as { providers: Map<string, InteractiveTerminalProvider> }
    internal.providers.set('later', new StubProvider('later'))
    disposeStale()
    expect(service.listProviders()).toEqual(['stub', 'later'])
    internal.providers.clear()
  })

  it('rejects an empty provider type', async () => {
    const { service } = await setup()
    expect(() => service.registerProvider(new StubProvider(''))).toThrow('must be non-empty')
  })

  it('rejects a duplicate provider type', async () => {
    const { service } = await setup()
    expect(() => service.registerProvider(new StubProvider('stub'))).toThrow(/already registered/)
  })
})

describe('InteractiveTerminalService open', () => {
  it('publishes one terminal with its provider facts', async () => {
    const { service } = await setup()
    const snapshot = await service.open(owner, request)
    expect(snapshot).toEqual({
      terminalId: 'iterm-1',
      type: 'stub',
      pid: 4242,
      status: { kind: 'running' },
    })
    expect(service.list(owner)).toEqual([snapshot])
    expect(service.list(other)).toEqual([])
  })

  it('omits the process id for a provider that has none', async () => {
    const { service, provider } = await setup()
    provider.pid = undefined
    const snapshot = await service.open(owner, request)
    expect(snapshot).not.toHaveProperty('pid')
  })

  it('refuses a type no provider registered', async () => {
    const { service } = await setup()
    await expect(service.open(owner, { ...request, type: 'missing' })).rejects.toMatchObject({
      code: 'NO_PROVIDER',
    })
  })

  it('refuses an already-aborted open before touching the provider', async () => {
    const { service, provider } = await setup()
    const controller = new AbortController()
    controller.abort(new Error('cancelled early'))
    await expect(service.open(owner, request, controller.signal)).rejects.toThrow('cancelled early')
    expect(provider.specs).toHaveLength(0)
  })

  it('closes the provider session when the open is cancelled after allocation', async () => {
    const { service, provider } = await setup()
    const controller = new AbortController()
    provider.openGate = gate()
    const pending = service.open(owner, request, controller.signal)
    await Promise.resolve()
    controller.abort(new Error('cancelled late'))
    provider.openGate.resolve()
    await expect(pending).rejects.toThrow('cancelled late')
    expect(provider.latest.closeReasons).toEqual(['interactive terminal open was cancelled'])
    expect(service.list(owner)).toEqual([])
  })

  it('closes the provider session when the service disposes during allocation', async () => {
    const { service, provider, dispose } = await setup()
    provider.openGate = gate()
    const pending = service.open(owner, request)
    await Promise.resolve()
    const disposing = dispose()
    provider.openGate.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
    expect(provider.latest.closeReasons).toEqual(['interactive terminal service is disposing'])
    await disposing
  })

  it('refuses an open once the service is disposing', async () => {
    const { service, dispose } = await setup()
    await dispose()
    await expect(service.open(owner, request)).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
  })

  it('propagates a provider allocation failure', async () => {
    const { service, provider } = await setup()
    provider.openFailure = new Error('allocation failed')
    await expect(service.open(owner, request)).rejects.toThrow('allocation failed')
    expect(service.list(owner)).toEqual([])
  })
})

describe('InteractiveTerminalService operations', () => {
  it('routes writes and resizes to the owning session', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    await service.write(owner, terminalId, 'ls\r')
    await service.resize(owner, terminalId, 120, 40)
    expect(provider.latest.writes).toEqual(['ls\r'])
    expect(provider.latest.resizes).toEqual([{ cols: 120, rows: 40 }])
  })

  it('refuses writes and resizes that name an unknown or foreign terminal', async () => {
    const { service } = await setup()
    const { terminalId } = await service.open(owner, request)
    await expect(service.write(owner, InteractiveTerminalId('iterm-99'), 'x')).rejects.toMatchObject({ code: 'NO_TERMINAL' })
    await expect(service.write(other, terminalId, 'x')).rejects.toMatchObject({ code: 'FOREIGN_TERMINAL' })
    await expect(service.resize(owner, InteractiveTerminalId('iterm-99'), 1, 1)).rejects.toMatchObject({ code: 'NO_TERMINAL' })
    await expect(service.resize(other, terminalId, 1, 1)).rejects.toMatchObject({ code: 'FOREIGN_TERMINAL' })
  })

  it('rejects dimensions that are not positive safe integers', async () => {
    const { service } = await setup()
    const { terminalId } = await service.open(owner, request)
    await expect(service.resize(owner, terminalId, 0, 24)).rejects.toThrow('cols must be a positive safe integer')
    await expect(service.resize(owner, terminalId, 80, 1.5)).rejects.toThrow('rows must be a positive safe integer')
  })

  it('refuses writes and resizes once a close is in flight', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    provider.latest.closeGate = gate()
    const closing = service.close(owner, terminalId)
    await expect(service.write(owner, terminalId, 'x')).rejects.toThrow('is closing')
    await expect(service.resize(owner, terminalId, 80, 24)).rejects.toThrow('is closing')
    expect(provider.latest.writes).toEqual([])
    expect(provider.latest.resizes).toEqual([])
    provider.latest.closeGate.resolve()
    await closing
  })

  it('allows exactly one live output generation per terminal', async () => {
    const { service } = await setup()
    const { terminalId } = await service.open(owner, request)
    const controller = new AbortController()
    const stream = service.frames(owner, terminalId, controller.signal)
    expect(() => service.frames(owner, terminalId, new AbortController().signal)).toThrow(InteractiveTerminalError)
    controller.abort()
    expect(await consume(stream)).toEqual([])
    const recovered = new AbortController()
    const second = service.frames(owner, terminalId, recovered.signal)
    recovered.abort()
    expect(await consume(second)).toEqual([])
  })

  it('refuses frames for an unknown or foreign terminal', async () => {
    const { service } = await setup()
    const { terminalId } = await service.open(owner, request)
    expect(() => service.frames(owner, InteractiveTerminalId('iterm-99'), new AbortController().signal))
      .toThrow('unknown interactive terminal')
    expect(() => service.frames(other, terminalId, new AbortController().signal))
      .toThrow('belongs to another session')
  })
})

describe('InteractiveTerminalService output', () => {
  it('yields retained output, then the exit frame that ends the stream', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    provider.latest.emit('hello ')
    provider.latest.emit('world')
    const pending = frames(service, terminalId, new AbortController().signal)
    await provider.latest.close('test over')
    const seen = await pending
    expect(seen.map(frame => frame.kind)).toEqual(['output', 'output', 'exit'])
    expect(Buffer.concat(seen
      .filter((frame): frame is { kind: 'output'; data: Uint8Array } => frame.kind === 'output')
      .map(frame => frame.data)).toString('utf8')).toBe('hello world')
    expect(seen.at(-1)).toEqual({ kind: 'exit', status: { kind: 'exited', exitCode: 0, signal: null } })
  })

  it('reports a transport failure as the stream’s last frame', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    const pending = frames(service, terminalId, new AbortController().signal)
    provider.latest.crash(new Error('transport down'))
    expect(await pending).toEqual([{ kind: 'failed', message: 'transport down' }])
  })

  it('describes a non-Error transport failure by its text', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    const pending = frames(service, terminalId, new AbortController().signal)
    provider.latest.crash('plain failure')
    expect(await pending).toEqual([{ kind: 'failed', message: 'plain failure' }])
  })

  it('ends the stream when the provider output ends without a close', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    const pending = frames(service, terminalId, new AbortController().signal)
    provider.latest.end()
    expect(await pending).toEqual([{ kind: 'exit', status: { kind: 'running' } }])
  })
})

describe('InteractiveTerminalService close', () => {
  it('closes once, reports the duplicate, and forgets the terminal', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    provider.latest.closeGate = gate()
    const first = service.close(owner, terminalId)
    const second = service.close(owner, terminalId)
    provider.latest.closeGate.resolve()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
    expect(service.list(owner)).toEqual([])
    await expect(service.close(owner, terminalId)).rejects.toMatchObject({ code: 'NO_TERMINAL' })
  })

  it('keeps the terminal addressable when provider cleanup fails', async () => {
    const { service, provider } = await setup()
    const { terminalId } = await service.open(owner, request)
    provider.latest.closeFailure = new Error('cleanup failed')
    await expect(service.close(owner, terminalId)).rejects.toThrow('cleanup failed')
    await service.write(owner, terminalId, 'still here')
    expect(provider.latest.writes).toEqual(['still here'])
  })

  it('closes every terminal one Session owns and aggregates cleanup failures', async () => {
    const { service, provider } = await setup()
    const first = await service.open(owner, request)
    await service.open(owner, request)
    await service.open(other, request)
    sessionAt(provider, 1).closeFailure = new Error('second cleanup failed')

    await expect(service.closeOwner(owner)).rejects.toThrow(/failed to close 1 interactive terminal\(s\)/)
    // The terminal whose provider cleanup failed stays addressable; the one
    // that closed cleanly is gone.
    expect(service.list(owner).map(snapshot => snapshot.terminalId)).toEqual(['iterm-2'])
    expect(service.list(other)).toHaveLength(1)
    expect(provider.sessions[0]?.closeReasons).toEqual(['session closed'])
    expect(first.terminalId).toBe('iterm-1')
  })

  it('closes every remaining terminal when the service disposes and clears providers', async () => {
    const { service, provider, dispose } = await setup()
    const { terminalId } = await service.open(owner, request)
    await dispose()
    expect(provider.latest.closeReasons).toEqual(['interactive terminal service disposed'])
    expect(service.listProviders()).toEqual([])
    await expect(service.write(owner, terminalId, 'x')).rejects.toMatchObject({ code: 'NO_TERMINAL' })
  })

  it('reports disposal failures from every owner it could not close', async () => {
    const { provider, service, dispose } = await setup()
    await service.open(owner, request)
    await service.open(other, request)
    sessionAt(provider, 0).closeFailure = new Error('first owner cleanup failed')
    sessionAt(provider, 1).closeFailure = new Error('second owner cleanup failed')
    // Cordis logs a throwing effect disposer instead of rejecting, so disposal
    // failure is observed on the service's own teardown entry point.
    const internal = service as unknown as { disposeAll(): Promise<void> }
    await expect(internal.disposeAll()).rejects.toThrow(/failed to close 2 interactive terminal owner\(s\)/)
    expect(service.listProviders()).toEqual([])
    // Disposal already cleared the provider registry, so the plugin's own
    // disposer now finds its contribution gone.
    await dispose()
  })
})
