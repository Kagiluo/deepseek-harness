import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SandboxProvider from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import InteractiveTerminalService, { InteractiveTerminalId } from '@deepseek-ai/dsh-terminal-interactive'
import type { Config } from '../src/config.ts'
import { LocalInteractiveTerminalProvider, apply, inject, name } from '../src/index.ts'

class EmptySandbox extends SandboxProvider {
  confine(_argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

class RecordingSandbox extends SandboxProvider {
  readonly calls: { argv: readonly string[]; policy: SandboxPolicy }[] = []

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    this.calls.push({ argv, policy })
    return { argv: ['/sandbox', '--', ...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

class StubRuntime extends SubprocessRuntime {
  readonly specs: SubprocessTerminalSpawnSpec[] = []

  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
    throw new Error('this runtime only allocates terminals')
  }

  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    this.specs.push(spec)
    const output = new PassThrough()
    const outcome = Promise.withResolvers<SubprocessOutcome>()
    return {
      pid: 321,
      output,
      done: outcome.promise,
      write: async () => {},
      resize: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 321,
      async terminate() {
        output.end()
        outcome.resolve({ exitCode: 0, signal: null })
      },
    }
  }
}

const quiet: Config = { providerType: 'shell', shellDialect: 'bash', disposeGraceMs: 10 }

/**
 * The configured row with a different registered provider type.
 * @param providerType - type the provider should register under.
 * @returns a complete configuration, written out rather than spread from `quiet`.
 */
function registeredAs(providerType: string): Config {
  return { providerType, shellDialect: 'bash', disposeGraceMs: 10 }
}

interface HarnessOptions {
  readonly mode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** A concrete sandbox provider class to mount; the abstract base is not mountable directly. */
  readonly sandbox?: Parameters<Context['plugin']>[0]
  readonly sessions?: boolean
  readonly config?: Config
}

async function harness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  runtime: StubRuntime
  provider: LocalInteractiveTerminalProvider
  sandbox: SandboxProvider | undefined
}> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, {
    mode: options.mode ?? 'danger-full-access',
    workspaceRoot: '/workspace',
  })
  await ctx.plugin(InteractiveTerminalService, { maxBufferedBytes: 4096 })
  await ctx.plugin(StubRuntime)
  const runtime = ctx.subprocess as StubRuntime
  let sandbox: SandboxProvider | undefined
  if (options.sandbox !== undefined) {
    await ctx.plugin(options.sandbox)
    sandbox = ctx.sandbox
  }
  if (options.sessions === true) await ctx.plugin(SessionStore)
  await ctx.plugin({ name, inject, apply }, options.config ?? quiet)
  const provider = new LocalInteractiveTerminalProvider(ctx, 'shell', {
    providerType: 'shell',
    shellDialect: 'bash',
    shellPath: '/bin/bash',
    shellArgs: ['-i'],
    disposeGraceMs: 10,
  })
  return { ctx, runtime, provider, sandbox }
}

const owner = SessionId('session-1')
const request = { type: 'shell', cwd: '/workspace/project', cols: 100, rows: 30 }

describe('terminal-interactive-local plugin', () => {
  it('registers the configured provider type', async () => {
    const { ctx } = await harness()
    expect(ctx.interactiveTerminals.listProviders()).toEqual(['shell'])
  })

  it('registers the configured type when it is overridden', async () => {
    const { ctx } = await harness({ config: registeredAs('pty-shell') })
    expect(ctx.interactiveTerminals.listProviders()).toEqual(['pty-shell'])
  })

  it('rejects an unusable configuration while loading', async () => {
    await expect(harness({ config: registeredAs('') })).rejects.toThrow('providerType must be non-empty')
    expect(name).toBe('terminal-interactive-local')
  })
})

describe('LocalInteractiveTerminalProvider allocation', () => {
  it('spawns the configured shell in the requested directory with terminal environment', async () => {
    const { ctx, runtime } = await harness()
    const snapshot = await ctx.interactiveTerminals.open(owner, request)
    expect(snapshot).toMatchObject({ type: 'shell', pid: 321, status: { kind: 'running' } })
    expect(runtime.specs).toHaveLength(1)
    expect(runtime.specs[0]).toMatchObject({
      argv: ['/bin/bash', '-i'],
      cwd: '/workspace/project',
      rows: 30,
      cols: 100,
      graceMs: 10,
    })
    expect(runtime.specs[0]?.env).toMatchObject({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      DSH_SHELL: '1',
      DSH_SESSION_ID: 'session-1',
      DSH_PTY_SESSION_ID: snapshot.terminalId,
    })
  })

  it('defaults the working directory to the policy root of the owning Session', async () => {
    const { ctx, runtime } = await harness({ sessions: true })
    ctx.sessions.create(owner, { meta: { cwd: '/session-root' } })
    await ctx.interactiveTerminals.open(owner, { type: 'shell', cols: 80, rows: 24 })
    expect(runtime.specs[0]?.cwd).toBe(resolve('/session-root'))
  })

  it('confines the argv through the shared sandbox for a restricted mode', async () => {
    const { ctx, runtime, sandbox } = await harness({ mode: 'workspace-write', sandbox: RecordingSandbox, sessions: true })
    ctx.sessions.create(owner, { meta: { cwd: '/session-root' } })

    await ctx.interactiveTerminals.open(owner, request)

    const recorded = sandbox as RecordingSandbox
    expect(recorded.calls).toHaveLength(1)
    expect(recorded.calls[0]?.argv).toEqual(['/bin/bash', '-i'])
    expect(recorded.calls[0]?.policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: resolve('/session-root') })
    expect(runtime.specs[0]?.argv).toEqual(['/sandbox', '--', '/bin/bash', '-i'])
  })

  it('falls back to the deployment workspace root for a session that is not live', async () => {
    const { ctx, sandbox } = await harness({ mode: 'workspace-write', sandbox: RecordingSandbox, sessions: true })
    await ctx.interactiveTerminals.open(SessionId('cold-session'), request)
    expect((sandbox as RecordingSandbox).calls[0]?.policy).toMatchObject({ workspaceRoot: resolve('/workspace') })
  })

  it('refuses a restricted mode with no sandbox provider in the execution world', async () => {
    const { ctx } = await harness({ mode: 'workspace-write' })
    await expect(ctx.interactiveTerminals.open(owner, request)).rejects.toThrow(
      'sandbox mode "workspace-write" requires a ctx.sandbox provider',
    )
  })

  it('refuses a sandbox that confines the argv to nothing', async () => {
    const { ctx } = await harness({ mode: 'workspace-write', sandbox: EmptySandbox })
    await expect(ctx.interactiveTerminals.open(owner, request)).rejects.toThrow('sandbox returned empty argv')
  })

  it('refuses an already-cancelled allocation before spawning', async () => {
    const { ctx, runtime } = await harness()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(ctx.interactiveTerminals.open(owner, request, controller.signal)).rejects.toThrow('cancelled')
    expect(runtime.specs).toEqual([])
  })

  it('refuses a direct provider call whose signal is already aborted', async () => {
    const { provider } = await harness()
    const controller = new AbortController()
    controller.abort(new Error('cancelled directly'))
    await expect(provider.open({
      terminalId: InteractiveTerminalId('iterm-1'),
      owner,
      type: 'shell',
      cwd: '/workspace/project',
      cols: 100,
      rows: 30,
      signal: controller.signal,
    })).rejects.toThrow('cancelled directly')
  })
})
