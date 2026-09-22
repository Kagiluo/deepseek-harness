/**
 * Daily wall-clock scheduling: create and start one Session in a configured
 * workspace, following a preset prompt, at a fixed time of day.
 *
 * Tasks come from two layers, merged: the deployment's `cordis.yml` `config`
 * (the base layer, which a fresh profile or a headless run uses) and the
 * `scheduler` user-settings namespace, which the Web settings page writes.
 * Committing a change there re-arms every task without a restart.
 *
 * The plugin owns no durable schedule state of its own — the Sessions it
 * creates are the durable record — so a task that came due while the process
 * was not running is skipped rather than replayed.
 * @module @deepseek-ai/dsh-scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the settings plugin's Context merge (ctx.settings) into this program.
import type {} from '@deepseek-ai/dsh-settings'
import { resolveArmedTasks, validateTaskStructure } from './config.ts'
import { TaskRuntime } from './runtime.ts'
import { SCHEDULER_SETTINGS_NAMESPACE, schedulerSettingsSchema, taskSchema, unattendedPresets } from './settings.ts'
import type { SchedulerTask } from './types.ts'

export type * from './types.ts'
export { RUN_DEADLINE_MS } from './session.ts'
export type { RunOutcome } from './session.ts'
export { SchedulerConfigError, resolveArmedTasks, validateTaskStructure } from './config.ts'
export type { ArmedTasks, SkippedTask } from './config.ts'
export { SCHEDULER_SETTINGS_NAMESPACE, schedulerSettingsSchema, unattendedPresets } from './settings.ts'
export type { SchedulerSettings } from './settings.ts'
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
 * not, and the plugin reads it through `ctx.get` so a deployment can schedule
 * from `Config` alone.
 */
export const inject = [
  'agents',
  'agentDefaultModel',
  'permissionPresets',
  'sessions',
  'sessionTitle',
  'workspaceRegistry',
]

/** Plugin configuration: the tasks the deployment ships, below any user layer. */
export interface Config {
  /**
   * Daily tasks to run. This is the base layer: the Web settings page writes
   * the user layer, which replaces it once a user saves a task list there.
   */
  tasks: SchedulerTask[]
}

/** Runtime schema for the deployment's task layer. */
export const Config: z<Config> = z.object({
  tasks: z.array(taskSchema(z.string().required())).default([]),
})

/**
 * Validate the configured task structure, then arm one runtime per resolvable
 * task, re-arming whenever the stored task list changes.
 *
 * @param ctx - Plugin context carrying the session-creation services.
 * @param config - Validated deployment task config.
 * @throws {SchedulerConfigError} when a configured task cannot denote a runnable occurrence.
 */
export function apply(ctx: Context, config: Config): void {
  validateTaskStructure(config.tasks)
  const lifetime = new AbortController()
  let runtimes: TaskRuntime[] = []
  let generation = 0
  const entry = config.tasks
  let source: () => readonly SchedulerTask[] = () => entry

  /**
   * Resolve the current task list and swap the armed set to match.
   *
   * The swap is ordered so no occurrence can be missed or double-armed: the new
   * runtimes are constructed first, then the old ones are disposed, and only
   * then does the new set start. A generation counter makes a superseded
   * resolution — one whose `resolve` settled after a later change arrived —
   * discard its own result instead of resurrecting a stale schedule.
   */
  const reload = async (): Promise<void> => {
    const mine = ++generation
    const { armed, skipped } = await resolveArmedTasks(ctx, source())
    if (mine !== generation) return
    for (const task of skipped) ctx.logger.warn(`scheduler: task "${task.id}" is not armed: ${task.reason}`)
    const previous = runtimes
    runtimes = armed.map(task => new TaskRuntime(ctx, task, lifetime.signal))
    await Promise.allSettled(previous.map(runtime => runtime.dispose()))
    for (const runtime of runtimes) runtime.start()
  }
  const rearm = (): void => {
    /* v8 ignore next 3 -- unreachable while every `reload` step contains its own errors. */
    reload().catch((error: unknown) => {
      ctx.logger.warn(`scheduler: re-arm failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const eligible = unattendedPresets(ctx.permissionPresets.names, name => ctx.permissionPresets.resolve(name))
  ctx.effect(() => {
    rearm()
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SCHEDULER_SETTINGS_NAMESPACE, schedulerSettingsSchema(eligible), { tasks: entry }, {
        validate: (value) => { validateTaskStructure(value.tasks) },
        setSource: (current) => { source = () => current().tasks },
        onChange: rearm,
      })
    })
    return async () => {
      lifetime.abort(new Error('scheduler unloaded'))
      const pending = runtimes
      runtimes = []
      await Promise.allSettled(pending.map(runtime => runtime.dispose()))
    }
  }, 'scheduler.lifecycle()')
}
