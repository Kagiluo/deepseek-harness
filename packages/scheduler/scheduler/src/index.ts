/**
 * Daily wall-clock scheduling: create and start one Session in a configured
 * workspace, following a preset prompt, at a fixed time of day.
 *
 * Tasks come from two layers of one `Config`: the deployment's `cordis.yml`
 * entry (the composition base) and the `scheduler` user settings section,
 * which the Web settings page writes. `Config.tasks` is volatile, so a
 * committed change reaches the running plugin as a `loader/volatile-update`
 * and re-arms every task without a restart.
 *
 * The plugin owns no durable schedule state of its own — the Sessions it
 * creates are the durable record — so a task that came due while the process
 * was not running is skipped rather than replayed.
 * @module @deepseek-ai/dsh-scheduler
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the settings plugin's Context merge (ctx.settings) into this program.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the Loader's `loader/volatile-update` event into this program.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { resolveArmedTasks, validateTaskStructure } from './config.ts'
import { TaskRuntime } from './runtime.ts'
import { taskSchema } from './settings.ts'
import type { SchedulerTask } from './types.ts'

export type * from './types.ts'
export { RUN_DEADLINE_MS } from './session.ts'
export type { RunOutcome } from './session.ts'
export { SchedulerConfigError, resolveArmedTasks, validateTaskStructure } from './config.ts'
export type { ArmedTasks, SkippedTask } from './config.ts'
export { SCHEDULER_SETTINGS_NAMESPACE, unattendedPresets } from './settings.ts'
export { SchedulerTimeError, nextOccurrence, resolveDailySchedule, resolveTimeZone } from './time.ts'
export type { DailySchedule } from './time.ts'
export { MAX_TIMER_DELAY_MS, TaskRuntime } from './runtime.ts'

/** Cordis function-plugin name. */
export const name = 'scheduler'

/**
 * Services every declared task needs before the first occurrence can run.
 * `agentPresets` is deliberately absent: a deployment may configure no roster,
 * and the plugin reads that optional service through `ctx.get`. `settings` is
 * absent for the same reason: the Web profile mounts it, a bare profile may
 * not, and the plugin injects it only to opt out of the generated settings
 * form, so a deployment can schedule from `Config` alone.
 */
export const inject = [
  'agents',
  'agentDefaultModel',
  'permissionPresets',
  'sessions',
  'sessionTitle',
  'workspaceRegistry',
]

/**
 * Plugin configuration: the tasks the deployment ships, holding the live task
 * list the settings page replaces.
 */
export interface Config {
  /**
   * Daily tasks to run. Volatile, so the settings page edits the live list
   * without remounting the plugin. This is the base layer: the `scheduler`
   * user section replaces it once a user saves a list there.
   */
  tasks: Volatile<SchedulerTask[]>
}

/** Runtime schema for the deployment's task layer and its settings form. */
export const Config = z.object({
  tasks: z.array(taskSchema(z.string().required())).default([]).volatile(),
})

/**
 * Validate the configured task structure, then arm one runtime per resolvable
 * task, re-arming whenever the volatile task list changes.
 *
 * @param ctx - Plugin context carrying the session-creation services.
 * @param config - Validated live task config.
 * @throws {SchedulerConfigError} when a configured task cannot denote a runnable occurrence.
 */
export function apply(ctx: Context, config: Config): void {
  validateTaskStructure(config.tasks.get())
  const lifetime = new AbortController()
  let runtimes: TaskRuntime[] = []
  let generation = 0
  const source = (): readonly SchedulerTask[] => config.tasks.get()

  /**
   * Resolve the current task list and swap the armed set to match.
   *
   * The swap is ordered so no occurrence can be missed or double-armed: the new
   * runtimes are constructed first, then the old ones are disposed, and only
   * then does the new set start. A generation counter makes a superseded
   * resolution — one whose `resolve` settled after a later change arrived —
   * discard its own result instead of resurrecting a stale schedule.
   *
   * The structure check runs again here because a stored list can be edited
   * outside the settings page. A failure rejects this resolution, which
   * `rearm` logs, leaving the previous arm set running rather than arming a
   * task that could never denote an occurrence.
   */
  const reload = async (): Promise<void> => {
    const mine = ++generation
    validateTaskStructure(source())
    const { armed, skipped } = await resolveArmedTasks(ctx, source())
    if (mine !== generation) return
    for (const task of skipped) ctx.logger.warn(`scheduler: task "${task.id}" is not armed: ${task.reason}`)
    const previous = runtimes
    runtimes = armed.map(task => new TaskRuntime(ctx, task, lifetime.signal))
    await Promise.allSettled(previous.map(runtime => runtime.dispose()))
    for (const runtime of runtimes) runtime.start()
  }
  const rearm = (): void => {
    reload().catch((error: unknown) => {
      ctx.logger.warn(`scheduler: re-arm failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  ctx.effect(() => {
    rearm()
    // This plugin ships its own settings page, so the Loader entry exposes no
    // generated form; `configure` owns that policy for this plugin instance.
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    // The settings write path commits a volatile-only change into the running
    // config and announces it on this fiber; the task list is already live.
    ctx.on('loader/volatile-update', () => { rearm() })
    return async () => {
      lifetime.abort(new Error('scheduler unloaded'))
      const pending = runtimes
      runtimes = []
      await Promise.allSettled(pending.map(runtime => runtime.dispose()))
    }
  }, 'scheduler.lifecycle()')
}
