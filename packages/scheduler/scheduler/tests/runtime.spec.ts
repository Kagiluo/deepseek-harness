/**
 * The armed daily runtime: one Session per occurrence, no overlap, no catch-up.
 *
 * The session transaction is replaced with a recorder so the timer's own
 * decisions — when it fires, what it reports, and what it skips — are observed
 * directly, with fake timers instead of sleeping.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunOutcome } from '../src/session.ts'
import { MAX_TIMER_DELAY_MS, TaskRuntime } from '../src/runtime.ts'
import { resolveDailySchedule } from '../src/time.ts'
import type { ResolvedSchedulerTask } from '../src/types.ts'

/** One recorded call to the session transaction. */
interface Call {
  readonly taskId: string
  readonly occurrenceAt: string
  settle: (outcome: RunOutcome) => void
  fail: (error: unknown) => void
}

const calls: Call[] = []

vi.mock('../src/session.ts', () => ({
  runScheduledTask: (
    _ctx: Context,
    task: ResolvedSchedulerTask,
    occurrenceAt: string,
  ): Promise<RunOutcome> => new Promise<RunOutcome>((resolve, reject) => {
    const entry: Call = {
      taskId: task.schedule.taskId,
      occurrenceAt,
      settle: (outcome) => { resolve(outcome) },
      // `reject` accepts an unknown reason; the wrapping keeps the rejection
      // reason an Error so the runtime's own handler is what receives it.
      fail: (error) => { reject(error instanceof Error ? error : new Error(String(error))) },
    }
    calls.push(entry)
  }),
}))

/** One armed task whose recurrence the caller names. */
function resolved(time = '09:30:00', timeZone = 'UTC'): ResolvedSchedulerTask {
  return {
    schedule: resolveDailySchedule({
      id: 'daily', workspacePath: '/tmp/workspace', time, timeZone,
      prompt: 'go', permissionPreset: 'unattended',
    }),
    workspacePath: '/tmp/workspace',
    title: 'daily',
    prompt: 'go',
    agentPreset: undefined,
    permissionPreset: 'unattended',
  }
}

let context: Context

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T08:00:00Z'))
  context = new Context()
  calls.length = 0
})

afterEach(async () => {
  vi.useRealTimers()
  await context.fiber.dispose()
})

/** Advance to just past the 09:30 UTC occurrence. */
async function reachOccurrence(): Promise<void> {
  await vi.advanceTimersByTimeAsync(90 * 60 * 1000 + 1)
}

describe('TaskRuntime firing', () => {
  it('exposes the Node clamp as its segment ceiling', () => {
    expect(MAX_TIMER_DELAY_MS).toBe(2_147_483_647)
  })

  it('starts exactly one run at the configured time, stamped with that occurrence', async () => {
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    expect(calls).toEqual([])
    await reachOccurrence()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.taskId).toBe('daily')
    expect(calls[0]?.occurrenceAt).toBe('2026-09-15T09:30:00.000Z')
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await runtime.dispose()
  })

  it('logs the terminal outcome once the run settles', async () => {
    const info = vi.spyOn(context.logger, 'info')
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    await reachOccurrence()
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await vi.advanceTimersByTimeAsync(0)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('completed for 2026-09-15T09:30:00.000Z'))
    await runtime.dispose()
  })

  it('contains a run that could not start, and keeps the schedule armed', async () => {
    const warn = vi.spyOn(context.logger, 'warn')
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    await reachOccurrence()
    calls[0]?.fail(new Error('no workspace'))
    await vi.advanceTimersByTimeAsync(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not start its 2026-09-15T09:30:00.000Z run'))
    // The next day's occurrence is still armed.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(calls).toHaveLength(2)
    calls[1]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await runtime.dispose()
  })

  it('skips an occurrence that came due while the previous run was still in flight', async () => {
    const warn = vi.spyOn(context.logger, 'warn')
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    await reachOccurrence()
    expect(calls).toHaveLength(1)
    // Leave the first run in flight across the next day's occurrence.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is still running; skipping its 2026-09-16T09:30:00.000Z occurrence'))
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await vi.advanceTimersByTimeAsync(0)
    // Once free, the following occurrence runs again.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(calls).toHaveLength(2)
    calls[1]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await runtime.dispose()
  })

  it('never replays an occurrence that passed while the process was down', async () => {
    // 08:00 now with a 07:00 target: the first armed occurrence is tomorrow.
    const runtime = new TaskRuntime(context, resolved('07:00:00'), new AbortController().signal)
    runtime.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
    expect(calls.map(call => call.occurrenceAt)).toEqual(['2026-09-16T07:00:00.000Z'])
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await runtime.dispose()
  })

  it('arms weekday-selected tasks on their next selected day only', async () => {
    // 2026-09-15 is a Tuesday; a Monday-only task next runs on 2026-09-21.
    const task = resolved('09:30:00')
    const runtime = new TaskRuntime(context, { ...task, schedule: { ...task.schedule, weekdays: [1] } }, new AbortController().signal)
    runtime.start()
    await vi.advanceTimersByTimeAsync(6 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
    expect(calls.map(call => call.occurrenceAt)).toEqual(['2026-09-21T09:30:00.000Z'])
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await runtime.dispose()
  })
})

describe('TaskRuntime lifetime', () => {
  it('re-arms instead of firing when a wake still has time left', async () => {
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    // The first segment is scheduled for 90 minutes. Step the clock back to
    // 07:00 so the timer callback observes the 09:30 target still ahead and
    // must re-arm rather than dispatch.
    vi.setSystemTime(new Date('2026-09-15T07:00:00Z'))
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000)
    expect(calls).toEqual([])
    // The re-armed segment now covers the remaining 150 minutes.
    await vi.advanceTimersByTimeAsync(150 * 60 * 1000 + 1)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.occurrenceAt).toBe('2026-09-15T09:30:00.000Z')
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await runtime.dispose()
  })

  it('ignores a start after disposal', async () => {
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    await runtime.dispose()
    runtime.start()
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
    expect(calls).toEqual([])
  })

  it('stops arming after disposal', async () => {
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    await runtime.dispose()
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
    expect(calls).toEqual([])
  })

  it('awaits an in-flight run to reach quiescence', async () => {
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    await reachOccurrence()
    let disposed = false
    const disposal = runtime.dispose().then(() => { disposed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(disposed).toBe(false)
    calls[0]?.settle({ sessionId: 's' as RunOutcome['sessionId'], status: 'completed' })
    await disposal
    expect(disposed).toBe(true)
  })

  it('is idempotent on repeated disposal', async () => {
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    runtime.start()
    await expect(runtime.dispose()).resolves.toBeUndefined()
    await expect(runtime.dispose()).resolves.toBeUndefined()
  })

  it('contains a clock that cannot resolve an occurrence and stops arming', async () => {
    const warn = vi.spyOn(context.logger, 'warn')
    const runtime = new TaskRuntime(context, resolved(), new AbortController().signal)
    vi.setSystemTime(new Date(Number.NaN))
    runtime.start()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot arm'))
    await runtime.dispose()
    expect(calls).toEqual([])
  })
})
