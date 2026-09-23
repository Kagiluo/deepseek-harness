// @vitest-environment jsdom
/**
 * TerminalBody over a stand-in emulator: one terminal per tab record, Host bytes
 * on the screen, keystrokes back as input, a fit that sends the new grid, every
 * failure as one line under the emulator, and teardown that closes the process.
 *
 * The real xterm.js measures glyphs and needs a layout engine; what this body
 * does with the emulator is what these specs drive, so the fake records the
 * calls and lets a spec press a key or run a fit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TerminalFrame, TerminalSnapshot } from '@deepseek-ai/dsh-api-terminal-controller/types'
import { TerminalBody, decodeFrame, exitText } from '../src/client/TerminalBody.tsx'
import type { TerminalBodyProps } from '../src/client/TerminalBody.tsx'
import type { TerminalInjected } from '../src/client/face.ts'
import { en } from '../src/client/locales.ts'

const xterm = vi.hoisted(() => {
  class FakeFitAddon {
    fits = 0
    fit(): void { this.fits += 1 }
  }
  class FakeTerminal {
    static created: FakeTerminal[] = []
    cols = 80
    rows = 24
    readonly written: string[] = []
    disposed = false
    addon: unknown
    host: unknown
    private listener: ((data: string) => void) | undefined
    constructor(readonly options: Record<string, unknown>) { FakeTerminal.created.push(this) }
    loadAddon(addon: unknown): void { this.addon = addon }
    open(element: unknown): void { this.host = element }
    onData(listener: (data: string) => void): { dispose: () => void } {
      this.listener = listener
      return { dispose: () => { this.listener = undefined } }
    }
    write(data: string | Uint8Array): void {
      this.written.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
    }
    dispose(): void { this.disposed = true }
    press(data: string): void { this.listener?.(data) }
    appliedFits(): number {
      return this.addon instanceof FakeFitAddon ? this.addon.fits : -1
    }
  }
  return { FakeTerminal, FakeFitAddon }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FakeFitAddon }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

/** What the body asks of the framework's ResizeObserver. */
class ResizeObserverStub {
  static created: ResizeObserverStub[] = []
  readonly observed = new Set<Element>()
  disconnected = false
  constructor(private readonly callback: ResizeObserverCallback) { ResizeObserverStub.created.push(this) }
  observe(target: Element): void { this.observed.add(target) }
  unobserve(target: Element): void { this.observed.delete(target) }
  disconnect(): void { this.disconnected = true; this.observed.clear() }
  /** Deliver one observation, as a browser does when the host box changes. */
  measure(): void { this.callback([], this) }
}

/** The one terminal this suite opens. */
const TERMINAL = 'terminal-1'

/** Set the laid-out size every emulator host reports, so a fit has cells to measure. */
function laidOut(width: number, height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
}

beforeEach(() => {
  xterm.FakeTerminal.created.length = 0
  ResizeObserverStub.created.length = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  laidOut(640, 480)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  ResizeObserverStub.created.length = 0
  // jsdom keeps both accessors on Element.prototype; deleting the own shadows restores them.
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)['clientWidth']
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)['clientHeight']
})

interface Call {
  readonly method: string
  readonly args: readonly unknown[]
}

/** What the Host answers an allocation with, when a case needs its own outcome. */
type Allocate = (cols: number, rows: number, signal: AbortSignal) => Promise<RemoteResult<TerminalSnapshot>>

/** The Host's follow-up stream, when a case needs its own failure or a gated one. */
type Stream = (signal: AbortSignal) => AsyncIterable<TerminalFrame>

const ALLOCATED: TerminalSnapshot = { terminalId: TERMINAL, status: { kind: 'running' } }

/**
 * Build the body's props over a controllable Host stream. Every injected call is
 * recorded whatever the case supplies, so a spec states the behavior it changed
 * and still asserts the calls around it.
 * @param options - the case's own allocation outcome or Host stream.
 * @returns the props, the recorded inject calls, the record signal, and the frame channel.
 */
function bench(options: { readonly allocate?: Allocate; readonly stream?: Stream } = {}) {
  const calls: Call[] = []
  const record = new AbortController()
  const queued: TerminalFrame[] = []
  let wake: (() => void) | undefined
  let ended = false
  const channel: AsyncIterable<TerminalFrame> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queued.length > 0) yield queued.shift() as TerminalFrame
        if (ended) return
        await new Promise<void>((resolve) => { wake = resolve })
      }
    },
  }
  const face: TerminalInjected = {
    open: async (cols, rows, signal) => {
      calls.push({ method: 'open', args: [cols, rows, signal] })
      return await (options.allocate?.(cols, rows, signal) ?? Promise.resolve({ ok: true, value: ALLOCATED }))
    },
    write: (terminalId, data) => { calls.push({ method: 'write', args: [terminalId, data] }) },
    resize: (terminalId, cols, rows) => { calls.push({ method: 'resize', args: [terminalId, cols, rows] }) },
    close: (terminalId) => { calls.push({ method: 'close', args: [terminalId] }) },
    output: (terminalId, signal) => {
      calls.push({ method: 'output', args: [terminalId, signal] })
      return options.stream?.(signal) ?? channel
    },
  }
  const props = {
    useTabInfo: () => ({ tab: { signal: record.signal } }),
    ...face,
    t: makeTranslate(en),
  } as unknown as TerminalBodyProps
  return {
    props,
    calls,
    record,
    methods: (): string[] => calls.map(call => call.method),
    argsOf: (method: string): readonly unknown[] | undefined => calls.find(call => call.method === method)?.args,
    emit(frame: TerminalFrame): void { queued.push(frame); wake?.(); wake = undefined },
    end(): void { ended = true; wake?.(); wake = undefined },
  }
}

/** An iterator that fails on its first read, standing in for a stream the Host cut. */
function failing(message: string): AsyncIterable<TerminalFrame> {
  return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error(message)) }) }
}

/** An iterator that fails once its gate opens, so a spec can cancel before the failure lands. */
function failingAfter(gate: Promise<void>, message: string): AsyncIterable<TerminalFrame> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => { await gate; throw new Error(message) },
    }),
  }
}

describe('TerminalBody', () => {
  it('opens one terminal at the emulator grid and draws the Host bytes', async () => {
    const b = bench()
    const view = render(<TerminalBody {...b.props} />)
    const terminal = xterm.FakeTerminal.created[0]
    expect(terminal?.host).toBe(view.container.querySelector('[data-interactive-terminal]'))
    expect(terminal?.options).toMatchObject({ cursorBlink: true, scrollback: 5000 })

    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })
    expect(b.argsOf('open')?.slice(0, 2)).toEqual([80, 24])
    expect(b.argsOf('output')?.[0]).toBe(TERMINAL)

    await act(async () => { b.emit({ kind: 'output', data: btoa('hello \u001b[0m') }) })
    await waitFor(() => { expect(terminal?.written).toEqual(['hello \u001b[0m']) })
  })

  it('says the terminal is starting until the Host answers', async () => {
    const open = Promise.withResolvers<RemoteResult<TerminalSnapshot>>()
    const b = bench({ allocate: async () => await open.promise })
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open']) })
    expect(view.getByRole('status').textContent).toBe('Starting terminal…')

    await act(async () => { open.resolve({ ok: true, value: ALLOCATED }) })
    await waitFor(() => { expect(view.queryByRole('status')).toBeNull() })
  })

  it('sends keystrokes as input once the terminal exists and drops them before it does', async () => {
    const open = Promise.withResolvers<RemoteResult<TerminalSnapshot>>()
    const b = bench({ allocate: async () => await open.promise })
    render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open']) })
    const terminal = xterm.FakeTerminal.created[0]

    act(() => { terminal?.press('early') })
    expect(b.methods()).toEqual(['open'])

    await act(async () => { open.resolve({ ok: true, value: ALLOCATED }) })
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })
    act(() => { terminal?.press('ls\r') })
    expect(b.argsOf('write')).toEqual([TERMINAL, 'ls\r'])
  })

  it('sends the emulator grid on every fit the host box allows', async () => {
    const b = bench()
    render(<TerminalBody {...b.props} />)
    const terminal = xterm.FakeTerminal.created[0]
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })

    expect(terminal?.appliedFits()).toBe(1)
    expect(b.methods()).not.toContain('resize')

    terminal!.cols = 100
    terminal!.rows = 30
    act(() => { ResizeObserverStub.created[0]?.measure() })
    expect(b.argsOf('resize')).toEqual([TERMINAL, 100, 30])
    expect(terminal?.appliedFits()).toBe(2)
  })

  it.each([
    ['no width', 0, 480],
    ['no height', 640, 0],
  ])('measures nothing while the host box has %s', async (_case, width, height) => {
    laidOut(width, height)
    const b = bench()
    render(<TerminalBody {...b.props} />)
    const terminal = xterm.FakeTerminal.created[0]
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })

    act(() => { ResizeObserverStub.created[0]?.measure() })
    expect(terminal?.appliedFits()).toBe(0)
    expect(b.methods()).not.toContain('resize')
  })

  it('reports a refused allocation and closes nothing', async () => {
    const b = bench({
      allocate: async () => ({ ok: false, error: { code: 'no-provider', message: 'no terminal provider' } } as never),
    })
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => {
      expect(view.getByRole('status').textContent).toBe('Terminal connection failed: no terminal provider')
    })

    await act(async () => { view.unmount() })
    expect(b.methods()).not.toContain('close')
    expect(xterm.FakeTerminal.created[0]?.disposed).toBe(true)
  })

  it('reports a failed stream and stops following it', async () => {
    const b = bench()
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })

    await act(async () => { b.emit({ kind: 'failed', message: 'pty closed' }); b.end() })
    await waitFor(() => { expect(view.getByRole('status').textContent).toBe('Terminal connection failed: pty closed') })
  })

  it('reports a stream that throws while the tab is alive', async () => {
    const b = bench({ stream: () => failing('gateway closed') })
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => {
      expect(view.getByRole('status').textContent).toBe('Terminal connection failed: Error: gateway closed')
    })
  })

  it.each([
    ['a code', { kind: 'exited', exitCode: 3, signal: null } as const, 'Terminal exited (code 3)'],
    ['a signal', { kind: 'exited', exitCode: null, signal: 'SIGTERM' } as const, 'Terminal ended (signal SIGTERM)'],
    ['a code and a signal', { kind: 'exited', exitCode: 1, signal: 'SIGKILL' } as const, 'Terminal ended (signal SIGKILL)'],
    ['neither', { kind: 'running' } as const, 'Terminal exited'],
  ])('reports an ending with %s as its own line', async (_case, status, text) => {
    const b = bench()
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })

    await act(async () => { b.emit({ kind: 'exit', status }); b.end() })
    await waitFor(() => { expect(view.getByRole('status').textContent).toBe(text) })
  })

  it('stops following the Host stream once its tab record ends', async () => {
    const b = bench()
    render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })
    const stream = b.argsOf('output')?.[1] as AbortSignal
    expect(stream.aborted).toBe(false)

    await act(async () => { b.record.abort() })
    expect(stream.aborted).toBe(true)
  })

  it('says nothing when a cancelled stream fails because the tab record ended', async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const b = bench({ stream: () => failingAfter(gate.promise, 'cancelled') })
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })

    await act(async () => { b.record.abort() })
    gate.resolve()
    await act(async () => { await Promise.resolve() })
    expect(view.queryByRole('status')).toBeNull()
    expect(view.container.querySelector('[data-interactive-terminal]')).not.toBeNull()
  })

  it('closes the terminal and releases the emulator when the tab unmounts', async () => {
    const b = bench()
    const view = render(<TerminalBody {...b.props} />)
    await waitFor(() => { expect(b.methods()).toEqual(['open', 'output']) })

    await act(async () => { view.unmount() })
    expect(b.argsOf('close')).toEqual([TERMINAL])
    expect(xterm.FakeTerminal.created[0]?.disposed).toBe(true)
    expect(ResizeObserverStub.created[0]?.disconnected).toBe(true)
  })
})

describe('decodeFrame', () => {
  it('returns the bytes a base64 frame carried', () => {
    expect([...decodeFrame(btoa('A\u0000'))]).toEqual([65, 0])
    expect([...decodeFrame('')]).toEqual([])
  })
})

describe('exitText', () => {
  const t = makeTranslate(en)

  it('names the code, the signal, and the bare ending', () => {
    expect(exitText(t, { kind: 'exited', exitCode: 7, signal: null })).toBe('Terminal exited (code 7)')
    expect(exitText(t, { kind: 'exited', exitCode: null, signal: 'SIGHUP' })).toBe('Terminal ended (signal SIGHUP)')
    expect(exitText(t, { kind: 'exited', exitCode: null, signal: null })).toBe('Terminal exited')
    expect(exitText(t, { kind: 'running' })).toBe('Terminal exited')
  })
})
