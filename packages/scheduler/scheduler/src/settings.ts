/**
 * The `scheduler` settings namespace: the user-authored task list the Web
 * settings page reads and writes.
 *
 * The namespace is separate from the plugin's `Config` so a deployment can ship
 * a starting schedule while a user edits their own. Settings resolve schema
 * defaults, then the composition base (`Config`), then the stored user section,
 * so the user's list replaces the shipped one once it exists.
 *
 * The `permissionPreset` field is a union of the presets this deployment can
 * actually run unattended, because the settings schema is also what the
 * settings page renders: advertising the eligible names there is what lets the
 * page offer a correct choice without duplicating the approval policy client
 * side. This mirrors how the permission namespace advertises its own default.
 * @module @deepseek-ai/dsh-scheduler/settings
 */

import z from '@deepseek-ai/schemastery'
import type { SchedulerTask } from './types.ts'

/** Settings namespace owning the user-authored task list. */
export const SCHEDULER_SETTINGS_NAMESPACE = 'scheduler'

/** Resolved value of the `scheduler` settings namespace. */
export interface SchedulerSettings {
  /** The authored tasks; an empty list means nothing is scheduled. */
  tasks: SchedulerTask[]
}

/**
 * Build the schema for one task record's fields.
 *
 * Both layers that carry tasks — the plugin `Config` and the settings namespace
 * — describe the same `SchedulerTask`, so they share this builder rather than
 * restating the fields. The only field that differs is `permissionPreset`, which
 * the settings layer narrows to the presets a deployment can run unattended.
 * @param permissionPreset - schema for the preset field, chosen by the caller.
 * @returns the task record schema.
 */
export function taskSchema(permissionPreset: z<string>): z<SchedulerTask> {
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
 * Build the `scheduler` settings schema.
 *
 * The schema depends on the deployment's permission-preset table, so it is
 * built once at mount rather than declared as a constant. An empty `eligible`
 * list falls back to a plain string, which keeps the namespace registrable in a
 * deployment that mounts no permission service — the task validation refuses
 * such a task at arm time with a message naming the real problem.
 * @param eligible - preset names whose approval policy is `never`.
 * @returns the namespace schema.
 */
export function schedulerSettingsSchema(eligible: readonly string[]): z<SchedulerSettings> {
  // `.required()` even for the union: a union node carries no implicit
  // requirement, so without it a stored task could omit the field this schema
  // and `SchedulerTask` both declare non-optional.
  const permissionPreset = eligible.length === 0
    ? z.string().required()
    : z.union(eligible.map(name => z.const(name))).required()
  return z.object({ tasks: z.array(taskSchema(permissionPreset as z<string>)).default([]) })
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
