/**
 * The `scheduler` settings entry: the task list the Web settings page
 * reads and writes.
 *
 * The namespace is this plugin's Loader entry id, and the plugin's own
 * `Config` is the settings form — `Config.tasks` is declared volatile, which is
 * what makes the task list editable without remounting the plugin. Settings
 * resolve schema defaults, then the composition base (`Config`), then the
 * stored user section, so a user's saved list replaces the shipped one.
 *
 * `unattendedPresets` selects the presets a scheduled run may use. Approval
 * policy is enforced when a task is armed, not when it is stored, because the
 * eligible set depends on the permission table mounted at that moment.
 * @module @deepseek-ai/dsh-scheduler/settings
 */

import z from '@deepseek-ai/schemastery'
import type { SchedulerTask } from './types.ts'

/** Loader entry id that owns the settings namespace, and the namespace itself. */
export const SCHEDULER_SETTINGS_NAMESPACE = 'scheduler'

/**
 * Build the schema for one task record's fields.
 *
 * `Config` is the only layer that carries tasks, so this builder has one
 * description of `SchedulerTask` rather than one per layer. The accepted input
 * is the writable field set a composition file or the settings wire carries —
 * `SchedulerTask` with a plain weekday array — and the produced value is
 * `SchedulerTask`.
 * @param permissionPreset - schema for the preset field.
 * @returns the task record schema.
 */
export function taskSchema(
  permissionPreset: z<string>,
): z<Omit<SchedulerTask, 'weekdays'> & { weekdays?: number[] }, SchedulerTask> {
  return z.object({
    id: z.string().required(),
    enabled: z.boolean(),
    workspacePath: z.string().required(),
    time: z.string().required(),
    timeZone: z.string(),
    weekdays: z.array(z.number().step(1).min(0).max(7)).default([0, 1, 2, 3, 4, 5, 6]),
    prompt: z.string().required(),
    agentPreset: z.string(),
    permissionPreset,
    title: z.string(),
  })
}

/**
 * The preset names this deployment can run unattended.
 * @param names - every preset name the permission table carries.
 * @param spec - the bundle each name resolves to.
 * @returns the names whose approval policy never asks a person.
 */
export function unattendedPresets(
  names: readonly string[],
  spec: (name: string) => { approval: string },
): string[] {
  return names.filter((name) => {
    try {
      return spec(name).approval === 'never'
    } catch {
      return false
    }
  })
}
