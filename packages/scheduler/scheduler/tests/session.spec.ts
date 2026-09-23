/**
 * The per-occurrence Session transaction: workspace binding, configuration,
 * prompt admission, rollback before admission, and release afterwards.
 *
 * The Agent registry, workspace registry, and dependent services are fixtures
 * that record what the transaction asked of them; only the real transaction
 * code runs. Each fixture answers from variables the test sets, so every
 * rollback, cancellation, and release path is reachable.
 */

import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_DEADLINE_MS, raceSettlement, runScheduledTask } from '../src/session.ts'
import type { ResolvedSchedulerTask } from '../src/types.ts'

/** What the fixtures observed, in call order. */
interface Trace {
  readonly events: string[]
  readonly prompts: { text: string; source: unknown }[]
  readonly warnings: string[]
}

/** Fixture answers one test overrides. */
interface Fixture {
  /** Mounted agent-preset roster, or undefined for a deployment without one. */
  presets: { mount: (ctx: Context, id: string) => Promise<{ id: string }> } | undefined
  /** Reject the durability flush. */
  failFlush: boolean
  /** Reject Agent disposal. */
  failDispose: boolean
  /** Reject the rollback detach. */
  failDetach: boolean
  /** Reject the rollback disposal. */
  failRollbackDispose: boolean
  /** Make the quiescence wait reject instead of settling. */
  rejectIdle: boolean
}

let trace: Trace
let fixture: Fixture
let context: Context
/** Deferred quiescence the test settles explicitly. */
let idle: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }
/** Replaced per test to make one step fail. */
let failStep: string | undefined
let disposed: number
let detached: number

const SESSION_ID = brandString<SessionId>('scheduler-daily-fixture')

/** One validated task for the transaction under test. */
function task(overrides: Partial<ResolvedSchedulerTask> = {}): ResolvedSchedulerTask {
  return {
    schedule: {
      taskId: 'daily', hour: 9, minute: 30, second: 0, weekdays: undefined, timeZone: 'UTC',
    },
    workspacePath: '/tmp/workspace',
    title: 'Nightly',
    prompt: 'do the thing',
    agentPreset: undefined,
    permissionPreset: 'unattended',
    ...overrides,
  }
}

/** The Session identity the fake Agent reports. */
function session(): { id: SessionId } {
  return { id: SESSION_ID }
}

function maybeFail(step: string): void {
  trace.events.push(step)
  if (failStep === step) throw new Error(`fixture refused: ${step}`)
}

beforeEach(() => {
  trace = { events: [], prompts: [], warnings: [] }
  fixture = {
    presets: undefined,
    failFlush: false,
    failDispose: false,
    failDetach: false,
    failRollbackDispose: false,
    rejectIdle: false,
  }
  failStep = undefined
  disposed = 0
  detached = 0
  const deferred = Promise.withResolvers<undefined>()
  idle = { promise: deferred.promise, resolve: () => { deferred.resolve(undefined) }, reject: (error) => { deferred.reject(error) } }

  context = new Context()
  // `ctx.logger` is a real service on every Context, so diagnostics are
  // observed by spying on it rather than by replacing it.
  vi.spyOn(context.logger as unknown as { warn: (message: string) => void }, 'warn')
    .mockImplementation((message: string) => { trace.warnings.push(message) })
  context.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  } as never)
  context.provide('permissionPresets', {
    resolve: () => { maybeFail('permission-resolve'); return { approval: 'never' } },
    set: () => { maybeFail('permission-set') },
  } as never)
  context.provide('sessionTitle', {
    rename: () => { maybeFail('rename') },
  } as never)
  context.provide('sessions', {
    flush: async () => {
      maybeFail('flush')
      if (fixture.failFlush) throw new Error('disk full')
      return true
    },
  } as never)
  context.provide('workspaceRegistry', {
    create: async () => {
      maybeFail('workspace-create')
      return {
        path: '/tmp/workspace',
        attachSession: async () => { maybeFail('attach') },
        detachSession: async () => {
          detached += 1
          trace.events.push('detach')
          if (fixture.failDetach) throw new Error('detach refused')
        },
      }
    },
  } as never)
  context.provide('agents', {
    create: async (options: { setup?: (ctx: Context) => Promise<void> }) => {
      maybeFail('agent-create')
      await options.setup?.(context)
      return {
        agent: {
          session: session(),
          followup: (message: { content: { text: string }[]; source: unknown }) => {
            trace.prompts.push({ text: message.content[0]?.text ?? '', source: message.source })
            maybeFail('followup')
          },
          whenIdle: () => fixture.rejectIdle
            ? Promise.reject(new Error('the turn blew up'))
            : idle.promise,
          cancel: () => { trace.events.push('cancel') },
        },
        dispose: async () => {
          disposed += 1
          trace.events.push('dispose')
          if (fixture.failDispose) throw new Error('dispose refused')
        },
      }
    },
  } as never)
  if (fixture.presets !== undefined) context.provide('agentPresets', fixture.presets as never)
})

/**
 * Mount a fixture agent-preset roster on the context.
 * @param mount - the roster's `mount` implementation.
 */
function providePresets(mount: (ctx: Context, id: string) => Promise<{ id: string }>): void {
  fixture.presets = { mount }
  context.provide('agentPresets', fixture.presets as never)
}

afterEach(async () => {
  await context.fiber.dispose()
})

/** Start one run and wait until its prompt is admitted. */
async function startAndAdmit(taskOverrides: Partial<ResolvedSchedulerTask> = {}): Promise<{
  outcome: Promise<{ sessionId: SessionId; status: string }>
}> {
  const deferred = Promise.withResolvers<{ sessionId: SessionId; status: string }>()
  void runScheduledTask(context, task(taskOverrides), '2026-09-15T09:30:00.000Z', new AbortController().signal)
    .then(deferred.resolve, deferred.reject)
  await vi.waitFor(() => { expect(trace.prompts).toHaveLength(1) })
  return { outcome: deferred.promise }
}

describe('runScheduledTask', () => {
  it('creates, attaches, configures, prompts, and releases one Session', async () => {
    const { outcome } = await startAndAdmit()
    idle.resolve()
    await expect(outcome).resolves.toEqual({ sessionId: SESSION_ID, status: 'completed' })
    expect(trace.events).toEqual([
      'permission-resolve', 'workspace-create', 'agent-create', 'attach',
      'permission-set', 'rename', 'followup', 'flush', 'dispose',
    ])
    expect(trace.prompts[0]?.text).toBe('do the thing')
    expect(trace.prompts[0]?.source).toMatchObject({
      kind: 'scheduler',
      taskId: 'daily',
      occurrenceAt: '2026-09-15T09:30:00.000Z',
      form: 'notice',
    })
    expect(disposed).toBe(1)
  })

  it('mounts the declared agent preset during setup', async () => {
    const mounted: string[] = []
    providePresets(async (_ctx, id) => { mounted.push(id); return { id } })
    const { outcome } = await startAndAdmit({ agentPreset: 'standard' })
    idle.resolve()
    await expect(outcome).resolves.toMatchObject({ status: 'completed' })
    expect(mounted).toEqual(['standard'])
  })

  it('refuses a declared agent preset when no roster is mounted', async () => {
    // The setup callback rejects before the Agent is published, so the
    // transaction rolls back and no prompt is ever admitted.
    await expect(runScheduledTask(context, task({ agentPreset: 'standard' }), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow(/no agent preset roster is mounted/)
    expect(trace.prompts).toEqual([])
    expect(detached).toBe(0)
  })

  it('rolls back the workspace and Agent when a step before admission fails', async () => {
    failStep = 'rename'
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow('fixture refused: rename')
    expect(trace.events).toContain('detach')
    expect(detached).toBe(1)
    expect(disposed).toBe(1)
    expect(trace.prompts).toEqual([])
  })

  it('contains a rollback detach failure and still disposes the Agent', async () => {
    fixture.failDetach = true
    failStep = 'rename'
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow('fixture refused: rename')
    expect(trace.warnings.some(line => line.includes('rollback failed'))).toBe(true)
    expect(disposed).toBe(1)
  })

  it('contains a rollback disposal failure without replacing the original error', async () => {
    fixture.failDispose = true
    failStep = 'rename'
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow('fixture refused: rename')
    expect(trace.warnings.some(line => line.includes('rollback failed'))).toBe(true)
  })

  it('detaches only a workspace it actually attached', async () => {
    failStep = 'attach'
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow('fixture refused: attach')
    expect(detached).toBe(0)
    expect(disposed).toBe(1)
  })

  it('rolls back when the Agent cannot even be created', async () => {
    failStep = 'agent-create'
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow('fixture refused: agent-create')
    expect(detached).toBe(0)
    expect(disposed).toBe(0)
  })

  it('does not roll back a failure after the prompt was admitted', async () => {
    let status: string | undefined
    const outcome = runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal)
      .then((value) => { status = value.status })
    await vi.waitFor(() => { expect(trace.prompts).toHaveLength(1) })
    idle.reject(new Error('the turn blew up'))
    await outcome
    // The transcript is durable and is what a reader inspects, so the Session stays.
    expect(status).toBe('failed')
    expect(detached).toBe(0)
    expect(disposed).toBe(1)
    expect(trace.warnings.some(line => line.includes('run failed'))).toBe(true)
  })

  it('reports a rejection from the pre-prompt permission lookup without creating a Session', async () => {
    failStep = 'permission-resolve'
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal))
      .rejects.toThrow('fixture refused: permission-resolve')
    expect(trace.events).toEqual(['permission-resolve'])
  })

  it('aborts before creating anything when the registration already unloaded', async () => {
    const controller = new AbortController()
    controller.abort(new Error('scheduler unloaded'))
    await expect(runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', controller.signal))
      .rejects.toThrow()
    // The preset is resolved before the first abort check, so nothing with a
    // side effect on the outside world has happened yet.
    expect(trace.events).toEqual(['permission-resolve'])
    expect(disposed).toBe(0)
  })

  it('aborts a run whose registration unloads during the turn', async () => {
    const controller = new AbortController()
    const deferred = Promise.withResolvers<{ sessionId: SessionId; status: string }>()
    void runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', controller.signal)
      .then(deferred.resolve, deferred.reject)
    await vi.waitFor(() => { expect(trace.prompts).toHaveLength(1) })
    controller.abort(new Error('scheduler unloaded'))
    idle.resolve()
    await expect(deferred.promise).resolves.toMatchObject({ status: 'failed' })
    expect(trace.events).toContain('cancel')
    expect(trace.warnings.some(line => line.includes('was cancelled because the scheduler unloaded'))).toBe(true)
  })

  it('cancels a run that exceeds its deadline', async () => {
    vi.useFakeTimers()
    try {
      const deferred = Promise.withResolvers<{ sessionId: SessionId; status: string }>()
      void runScheduledTask(context, task(), '2026-09-15T09:30:00.000Z', new AbortController().signal)
        .then(deferred.resolve, deferred.reject)
      await vi.waitFor(() => { expect(trace.prompts).toHaveLength(1) })
      await vi.advanceTimersByTimeAsync(RUN_DEADLINE_MS)
      idle.resolve()
      await expect(deferred.promise).resolves.toMatchObject({ status: 'timeout' })
      expect(trace.events).toContain('cancel')
      expect(trace.warnings.some(line => line.includes('exceeded its'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains a durability flush failure and still releases the Agent', async () => {
    fixture.failFlush = true
    const { outcome } = await startAndAdmit()
    idle.resolve()
    await expect(outcome).resolves.toMatchObject({ status: 'completed' })
    expect(trace.warnings.some(line => line.includes('durability flush failed'))).toBe(true)
    expect(disposed).toBe(1)
  })

  it('contains a disposal failure at release', async () => {
    fixture.failDispose = true
    const { outcome } = await startAndAdmit()
    idle.resolve()
    await expect(outcome).resolves.toMatchObject({ status: 'completed' })
    expect(trace.warnings.some(line => line.includes('disposal failed'))).toBe(true)
  })
})

describe('raceSettlement', () => {
  it('reports settlement when the run finishes first', async () => {
    const settled = Promise.withResolvers<undefined>()
    const race = raceSettlement(settled.promise, new AbortController().signal, 1000)
    settled.resolve(undefined)
    await expect(race).resolves.toBe('settled')
  })

  it('reports timeout when the deadline elapses first', async () => {
    vi.useFakeTimers()
    try {
      const race = raceSettlement(new Promise<void>(() => {}), new AbortController().signal, 50)
      await vi.advanceTimersByTimeAsync(50)
      await expect(race).resolves.toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports abort when the registration unloads first', async () => {
    const controller = new AbortController()
    const race = raceSettlement(new Promise<void>(() => {}), controller.signal, 60_000)
    controller.abort()
    await expect(race).resolves.toBe('aborted')
  })
})

describe('RUN_DEADLINE_MS', () => {
  it('is one hour, so a stalled Agent releases its only in-flight slot', () => {
    expect(RUN_DEADLINE_MS).toBe(3_600_000)
  })
})
