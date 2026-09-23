import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { LocalInteractiveSession } from '../src/session.ts'

interface TerminalFacts {
  readonly handle: SubprocessTerminalHandle
  readonly writes: string[]
  readonly resizes: { cols: number; rows: number }[]
  readonly terminateCalls: () => number
  readonly settle: (outcome: SubprocessOutcome) => void
  readonly failExit: (error: unknown) => void
  readonly failTerminate: (error: Error | undefined) => void
}

/** A terminal handle whose every provider call is observable. */
function terminal(): TerminalFacts {
  const output = new PassThrough()
  const outcome = Promise.withResolvers<SubprocessOutcome>()
  const writes: string[] = []
  const resizes: { cols: number; rows: number }[] = []
  let terminateError: Error | undefined
  let terminateCount = 0
  const handle: SubprocessTerminalHandle = {
    pid: 321,
    output,
    done: outcome.promise,
    async write(data: string) {
      writes.push(data)
    },
    async resize(cols: number, rows: number) {
      resizes.push({ cols, rows })
    },
    inspectForeground: async () => undefined,
    signalForeground: async () => 321,
    async terminate() {
      terminateCount += 1
      if (terminateError !== undefined) throw terminateError
      output.end()
      outcome.resolve({ exitCode: 0, signal: null })
    },
  }
  return {
    handle,
    writes,
    resizes,
    terminateCalls: () => terminateCount,
    settle: (value) => { output.end(); outcome.resolve(value) },
    failExit: (error) => { output.end(); outcome.reject(error) },
    failTerminate: (error) => { terminateError = error },
  }
}

describe('LocalInteractiveSession', () => {
  it('reports the provider pid and the running status before the process exits', () => {
    const session = new LocalInteractiveSession(terminal().handle)
    expect(session.pid).toBe(321)
    expect(session.status()).toEqual({ kind: 'running' })
  })

  it('forwards writes and resizes to the terminal handle', async () => {
    const facts = terminal()
    const session = new LocalInteractiveSession(facts.handle)
    await session.write('ls\r')
    await session.resize(120, 40)
    expect(facts.writes).toEqual(['ls\r'])
    expect(facts.resizes).toEqual([{ cols: 120, rows: 40 }])
  })

  it('exposes the provider output stream unchanged', () => {
    const facts = terminal()
    const session = new LocalInteractiveSession(facts.handle)
    expect(session.output).toBe(facts.handle.output)
  })

  it('reports the top-level process outcome once the terminal exits', async () => {
    const facts = terminal()
    const session = new LocalInteractiveSession(facts.handle)
    facts.settle({ exitCode: 3, signal: 'SIGTERM' })
    await facts.handle.done
    await Promise.resolve()
    expect(session.status()).toEqual({ kind: 'exited', exitCode: 3, signal: 'SIGTERM' })
  })

  it('reports unknown exit facts when the provider transport fails', async () => {
    const facts = terminal()
    const session = new LocalInteractiveSession(facts.handle)
    facts.failExit(new Error('transport down'))
    await expect(facts.handle.done).rejects.toThrow('transport down')
    await Promise.resolve()
    expect(session.status()).toEqual({ kind: 'exited', exitCode: null, signal: null })
  })

  it('closes through the provider once, however often close is called', async () => {
    const facts = terminal()
    const session = new LocalInteractiveSession(facts.handle)
    const first = session.close('client request')
    const second = session.close('client request')
    await Promise.all([first, second])
    expect(facts.terminateCalls()).toBe(1)
    expect(session.status()).toEqual({ kind: 'exited', exitCode: 0, signal: null })
  })

  it('reports a cleanup failure with the close reason and allows a retry', async () => {
    const facts = terminal()
    const session = new LocalInteractiveSession(facts.handle)
    facts.failTerminate(new Error('kill refused'))
    await expect(session.close('client request')).rejects.toThrow('interactive terminal cleanup failed (client request)')
    facts.failTerminate(undefined)
    await expect(session.close('client request')).resolves.toBeUndefined()
    expect(facts.terminateCalls()).toBe(2)
  })
})
