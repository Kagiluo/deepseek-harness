/**
 * One armed daily task: a bounded, re-segmented timer that starts exactly one
 * Session per occurrence and never overlaps two runs of the same task.
 *
 * Every wake re-reads the wall clock and re-derives the next occurrence from
 * the validated recurrence, so a system clock adjustment, a daylight-saving
 * transition, or an event-loop stall cannot leave a stale target armed. A due
 * time that passed while the process was not running is skipped rather than
 * replayed: the timer's target is always strictly in the future.
 * @module @deepseek-ai/dsh-scheduler/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { nextOccurrence } from './time.ts'
import { runScheduledTask } from './session.ts'
import type { ResolvedSchedulerTask } from './types.ts'

/**
 * Longest delay one `setTimeout` segment may carry. Node clamps a longer delay
 * to 1 ms and fires immediately, so a target further out is reached through
 * successive segments, each re-reading the wall clock.
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** One task's armed recurrence and its single in-flight run, if any. */
export class TaskRuntime {
  private timer: NodeJS.Timeout | undefined
  private run: Promise<void> | undefined
  private stopping = false
  private readonly stop = Promise.withResolvers<void>()
  private disposal: Promise<void> | undefined

  /**
   * Construct an unarmed runtime for one validated task.
   * @param ctx - Runtime context owning the plugin's services and lifetime.
   * @param task - The validated task this runtime arms.
   * @param signal - Registration lifetime; aborts an in-flight run during unload.
   */
  constructor(
    private readonly ctx: Context,
    private readonly task: ResolvedSchedulerTask,
    private readonly signal: AbortSignal,
  ) {}

  /** Arm the first occurrence strictly after now. */
  start(): void {
    this.arm()
  }

  /**
   * Stop arming, and let any in-flight run finish or be cancelled by the
   * registration's signal. Awaiting this reaches quiescence: no timer is
   * armed and no run remains in flight.
   * @returns fulfilment once this runtime has stopped all work.
   */
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.stopping = true
      this.clearTimer()
      this.stop.resolve()
      await Promise.allSettled([this.run])
    })()
  }

  /** Cancel the armed timer segment, if any. */
  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Arm one bounded segment toward the next occurrence. */
  private arm(): void {
    if (this.stopping) return
    const { schedule } = this.task
    const now = Date.now()
    let target: number
    try {
      target = nextOccurrence(schedule, now)
    } catch (error: unknown) {
      this.stopping = true
      this.ctx.logger.warn(`scheduler: task "${schedule.taskId}" cannot arm: ${errorChain(error)}`)
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.wake(target)
    }, Math.min(target - now, MAX_TIMER_DELAY_MS))
  }

  /** Re-check the clock after one segment elapsed. */
  private wake(target: number): void {
    /* v8 ignore next -- a queued callback cannot interleave a synchronous dispose; this guards the segment boundary only. */
    if (this.stopping) return
    if (Date.now() < target) {
      this.arm()
      return
    }
    this.dispatch(target)
  }

  /**
   * Start exactly one run for one due occurrence, then re-arm.
   *
   * A run still in flight at its own next due time makes this occurrence
   * overdue, and an overdue occurrence is skipped exactly like one that passed
   * while the process was down: the schedule advances to the next future
   * occurrence instead of queueing a backlog.
   * @param target - The occurrence instant that just became due.
   */
  private dispatch(target: number): void {
    if (this.run !== undefined) {
      this.ctx.logger.warn(
        `scheduler: task "${this.task.schedule.taskId}" is still running;`
        + ` skipping its ${new Date(target).toISOString()} occurrence`,
      )
      this.arm()
      return
    }
    const occurrenceAt = new Date(target).toISOString()
    const run = runScheduledTask(this.ctx, this.task, occurrenceAt, this.signal)
    this.run = run.then(
      (outcome) => {
        this.ctx.logger.info(
          `scheduler: task "${this.task.schedule.taskId}" Session "${outcome.sessionId}"`
          + ` ${outcome.status} for ${occurrenceAt}`,
        )
      },
      (error: unknown) => {
        this.ctx.logger.warn(
          `scheduler: task "${this.task.schedule.taskId}" could not start its ${occurrenceAt} run: ${errorChain(error)}`,
        )
      },
    ).finally(() => { this.run = undefined })
    this.arm()
  }
}
