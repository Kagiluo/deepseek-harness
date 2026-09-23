// @vitest-environment jsdom
/**
 * The terminal plugin's registrations on a real cordis Context with fake
 * Remote, registry, and slot faces: the tab type, its dictionaries, the body
 * keyed under the type's own id, the face's Remote calls, and the node half.
 *
 * Every call the face makes names the Session the factory was built for, so one
 * registration serves every terminal of every Session.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TerminalCloseResult, TerminalFrame, TerminalSnapshot,
} from '@deepseek-ai/dsh-api-terminal-controller/types'
import { apply, inject } from '../src/client/index.ts'
import { TERMINAL_ID, TERMINAL_KIND, terminalDefinition } from '../src/client/definition.ts'
import { terminalFace } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

// The body is registered but never rendered here, so the emulator only has to be constructible.
vi.mock('@xterm/xterm', () => ({ Terminal: class { disposed = false } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fits = 0 } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

afterEach(cleanup)

interface Call {
  readonly method: string
  readonly request: unknown
  readonly signal: unknown
}

/** A stream the Host never writes to and ends at once. */
function idle(): AsyncIterable<TerminalFrame> {
  return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }
}

/** One fake `terminals` namespace recording every call the face makes through it. */
function namespace(calls: Call[]): ClientRemote['terminals'] {
  const record = (method: string, request: unknown, signal: unknown): void => {
    calls.push({ method, request, signal })
  }
  const ok = <T>(value: T): Promise<RemoteResult<T>> => Promise.resolve({ ok: true, value })
  return {
    close: (request, signal) => {
      record('close', request, signal)
      return ok<TerminalCloseResult>({ closed: true })
    },
    list: (request) => {
      record('list', request, undefined)
      return ok<TerminalSnapshot[]>([])
    },
    open: (request, signal) => {
      record('open', request, signal)
      return ok<TerminalSnapshot>({ terminalId: 'terminal-1', status: { kind: 'running' } })
    },
    output: (request, signal) => {
      record('output', request, signal)
      return idle()
    },
    resize: (request, signal) => {
      record('resize', request, signal)
      return ok(undefined)
    },
    write: (request, signal) => {
      record('write', request, signal)
      return ok(undefined)
    },
  }
}

/**
 * Boot the browser half over fake faces.
 * @returns the context, its fiber, the recorded Remote calls, the registered definitions, and the injected face factory.
 */
async function bench() {
  const ctx = new Context()
  const calls: Call[] = []
  const definitions: unknown[] = []
  const terminals = namespace(calls)
  ctx.provide('remote', { terminals })
  ctx.provide('remote.terminals', terminals)
  ctx.provide('sidebarRightTabs', {
    register: (definition: unknown) => {
      definitions.push(definition)
      return (): void => { definitions.length = 0 }
    },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.slots.register({
    name: 'root',
    children: { 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' } },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    fiber,
    calls,
    definitions,
    terminals,
    entry: () => ctx.slots.entries('sidebar.right.pane.tab')[0],
  }
}

describe('ui-terminal browser plugin', () => {
  it('registers the terminal type, its dictionaries, and its body under the type id', async () => {
    const b = await bench()
    expect(b.definitions).toHaveLength(1)
    expect(b.definitions[0]).toMatchObject({ id: TERMINAL_ID, kind: TERMINAL_KIND, priority: 'builtin' })
    expect(b.entry()?.options).toMatchObject({ key: TERMINAL_ID })
    expect(b.entry()?.locale).toBe('terminal')
    expect(b.entry()?.inject).toBeTypeOf('function')
  })

  it('drops every registration when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.definitions).toHaveLength(0)
  })
})

describe('terminalDefinition', () => {
  it('names the type and offers one guide entry', () => {
    const definition = terminalDefinition(makeTranslate(en))
    expect(definition.id).toBe(TERMINAL_ID)
    expect(definition.kind).toBe(TERMINAL_KIND)
    expect(definition.priority).toBe('builtin')
    expect(definition.patterns).toBeUndefined()
    expect(definition.title('')).toBe('Terminal')
    expect(definition.guide?.[0]).toMatchObject({ order: 20 })
    expect(definition.guide?.[0]?.title()).toBe('Terminal')
    expect(definition.guide?.[0]?.description?.()).toBe("Open a real terminal in this session's workspace")
  })
})

describe('terminalFace', () => {
  it('addresses every call at the Session the factory was built for', async () => {
    const b = await bench()
    const face = terminalFace({ terminals: b.terminals })('session-9' as SessionId)
    const signal = new AbortController().signal
    expect(await face.open(120, 40, signal)).toMatchObject({ ok: true })
    face.write('terminal-1', 'ls\r')
    face.resize('terminal-1', 120, 40)
    face.close('terminal-1')
    expect(face.output('terminal-1', signal)).toBeDefined()

    expect(b.calls).toEqual([
      { method: 'open', request: { sessionId: 'session-9', cols: 120, rows: 40 }, signal },
      { method: 'write', request: { sessionId: 'session-9', terminalId: 'terminal-1', data: 'ls\r' }, signal: undefined },
      { method: 'resize', request: { sessionId: 'session-9', terminalId: 'terminal-1', cols: 120, rows: 40 }, signal: undefined },
      { method: 'close', request: { sessionId: 'session-9', terminalId: 'terminal-1' }, signal: undefined },
      { method: 'output', request: { sessionId: 'session-9', terminalId: 'terminal-1' }, signal },
    ])
  })
})

describe('terminal dictionaries', () => {
  it('keeps the English and Chinese key sets identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.values(en).every(value => value.length > 0)).toBe(true)
    expect(Object.values(zh).every(value => value.length > 0)).toBe(true)
  })
})

describe('ui-terminal node half', () => {
  it('contributes nothing', () => {
    expect(() => { nodeApply(undefined as never) }).not.toThrow()
  })
})
