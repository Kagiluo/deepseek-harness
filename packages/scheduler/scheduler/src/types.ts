/**
 * Scheduler vocabulary: one task declared by the deployment or authored in the
 * Web settings page, plus the durable record its Session keeps of the task and
 * occurrence that produced it.
 * @module @deepseek-ai/dsh-scheduler/types
 */

import type { DailySchedule } from './time.ts'

/**
 * One daily wall-clock task. Its structure — id, time, zone, and weekdays — is
 * validated when the plugin loads and on every re-arm; the references it names
 * are resolved when it is armed.
 */
export interface SchedulerTask {
  /** Stable task id naming this task in diagnostics, its Session title, and the scheduler metadata on the messages it admits. */
  readonly id: string
  /**
   * Whether this task is armed. Omission means enabled; `false` pauses the task
   * without deleting it, and a paused task's unusable references are not
   * reported, because pausing is the author's decision rather than a problem.
   */
  readonly enabled?: boolean
  /** Absolute path of an existing directory the created Session runs in. */
  readonly workspacePath: string
  /** Local wall-clock time of day, `HH:MM:SS` in 24-hour form. */
  readonly time: string
  /** IANA zone `time` is interpreted in; omission uses the process zone. */
  readonly timeZone?: string
  /**
   * Weekdays this task runs on, `0` (Sunday) through `6` (Saturday). Omission
   * runs it every day. An empty list is refused, because it never runs.
   */
  readonly weekdays?: readonly number[]
  /** Prompt text admitted as the created Session's first turn. */
  readonly prompt: string
  /**
   * Agent preset id the created Session joins. Omission joins the roster
   * default when the deployment configures a roster; declaring one where no
   * roster is configured is refused at load.
   */
  readonly agentPreset?: string
  /**
   * Permission preset applied to the created Session before its prompt. The
   * preset's approval policy must be `never`: no person is present to answer a
   * request, so a preset that asks would park the run indefinitely.
   */
  readonly permissionPreset: string
  /** Session title applied before the prompt; omission uses this task's `id`. */
  readonly title?: string
}

/** One configured task after load-time validation, ready to arm. */
export interface ResolvedSchedulerTask {
  /** The validated daily recurrence, carrying the task id. */
  readonly schedule: DailySchedule
  /** Absolute workspace directory the run creates its Session in. */
  readonly workspacePath: string
  /** Session title applied before the prompt. */
  readonly title: string
  /** Prompt text admitted as the first turn. */
  readonly prompt: string
  /** Agent preset id joined, or `undefined` when the task declares none. */
  readonly agentPreset: string | undefined
  /** Permission preset applied before the prompt. */
  readonly permissionPreset: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Programmatic input admitted by one scheduled task occurrence. */
    scheduler: {
      readonly kind: 'scheduler'
      /** Configured task id that produced this message. */
      readonly taskId: string
      /** RFC 3339 UTC instant of the occurrence this message was admitted for. */
      readonly occurrenceAt: string
      readonly form: 'notice'
      readonly summary: string
    }
  }
}
