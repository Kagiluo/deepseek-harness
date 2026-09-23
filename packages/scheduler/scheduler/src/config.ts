/**
 * Task validation, split by what can change while the process runs.
 *
 * A task's *structure* — its id, its wall-clock time, its zone, its weekdays —
 * is fixed by what the author wrote, so a structurally impossible task is
 * refused at the point it is authored. Everything a task *references* — the
 * workspace directory, the permission preset, the agent preset roster — can
 * change after the fact, so an unusable reference keeps that one task out of
 * the arm set and leaves the rest of the schedule running.
 *
 * That split is load-bearing rather than stylistic. Settings validate their
 * stored section again at registration, so a check that could fail later (a
 * deleted directory) would refuse the *mount* on the next boot and take the
 * whole process down with it.
 * @module @deepseek-ai/dsh-scheduler/config
 */

import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { resolveDailySchedule } from './time.ts'
import type { ResolvedSchedulerTask, SchedulerTask } from './types.ts'

/** Error naming a task field that cannot denote a runnable occurrence. */
export class SchedulerConfigError extends Error {
  /**
   * Construct a task-structure failure.
   * @param message - Actionable diagnostic naming the task and the accepted form.
   */
  constructor(message: string) {
    super(message)
    this.name = 'SchedulerConfigError'
  }
}

/** One task that is declared but could not be armed, with the reason why. */
export interface SkippedTask {
  /** The declared task id. */
  readonly id: string
  /** Why this task is not armed, in one line. */
  readonly reason: string
}

/** The arm set derived from one task list. */
export interface ArmedTasks {
  /** Tasks ready to arm, in declaration order. */
  readonly armed: readonly ResolvedSchedulerTask[]
  /** Enabled tasks whose references are currently unusable. */
  readonly skipped: readonly SkippedTask[]
}

/** Render a thrown value for one diagnostic line. */
function render(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Require one non-empty string field. */
function requiredString(value: unknown, subject: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SchedulerConfigError(`${subject} ${field} must be a non-empty string.`)
  }
  return value
}

/**
 * Validate the time-invariant structure of every declared task.
 *
 * These checks are safe to run at write time *and* at every boot: none of them
 * can start failing because the world changed. A caller that stores tasks —
 * the settings write path — uses this to refuse a task that could never run
 * rather than saving one that silently does nothing.
 * @param tasks - Declared tasks, in author order.
 * @throws {SchedulerConfigError} when a task field cannot denote a runnable occurrence.
 */
export function validateTaskStructure(tasks: readonly SchedulerTask[]): void {
  const seen = new Set<string>()
  tasks.forEach((task, position) => {
    const subject = `scheduler task #${String(position + 1)}`
    const id = requiredString(task.id, subject, 'id')
    const named = `scheduler task "${id}"`
    if (seen.has(id)) {
      throw new SchedulerConfigError(`duplicate scheduler task id "${id}"; each task id must be unique.`)
    }
    seen.add(id)
    const workspacePath = requiredString(task.workspacePath, named, 'workspacePath')
    if (!isAbsolute(workspacePath)) {
      throw new SchedulerConfigError(`${named} workspacePath must be absolute, got ${JSON.stringify(workspacePath)}.`)
    }
    requiredString(task.prompt, named, 'prompt')
    requiredString(task.permissionPreset, named, 'permissionPreset')
    try {
      resolveDailySchedule({ ...task, id })
    } catch (error: unknown) {
      throw new SchedulerConfigError(`${named} is not a valid daily schedule: ${render(error)}`)
    }
  })
}

/** Whether `path` names an existing directory, treating any stat failure as absence. */
function existsAsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve one structurally valid task against the services it references.
 * @param ctx - Loaded context carrying the permission preset service and, optionally, a roster.
 * @param task - The declared task.
 * @returns The task ready to arm.
 * @throws {SchedulerConfigError} when a reference this task names is unusable right now.
 */
async function resolveTask(ctx: Context, task: SchedulerTask): Promise<ResolvedSchedulerTask> {
  const named = `scheduler task "${task.id}"`
  if (!existsAsDirectory(task.workspacePath)) {
    throw new SchedulerConfigError(`${named} workspacePath ${JSON.stringify(task.workspacePath)} is not an existing directory.`)
  }
  const spec = ctx.permissionPresets.resolve(task.permissionPreset)
  if (spec.approval !== 'never') {
    throw new SchedulerConfigError(
      `${named} permissionPreset "${task.permissionPreset}" uses approval "${spec.approval}", but a scheduled run has nobody`
      + ' to answer an approval request and would park indefinitely; choose a preset whose approval policy is "never".',
    )
  }
  const presets = ctx.get('agentPresets')
  if (presets !== undefined && presets.roots.length > 0) {
    if (task.agentPreset === undefined) {
      throw new SchedulerConfigError(
        `${named} must declare agentPreset: this deployment configures an agent preset roster, and an Agent that addresses`
        + ' a model without joining one receives no tools or prompt sections.',
      )
    }
    await presets.resolve(task.agentPreset)
  } else if (task.agentPreset !== undefined) {
    throw new SchedulerConfigError(
      `${named} declares agentPreset "${task.agentPreset}", but this deployment configures no agent preset roster to join;`
      + ' remove the field or mount @deepseek-ai/dsh-agent-presets.',
    )
  }
  return {
    schedule: resolveDailySchedule(task),
    workspacePath: task.workspacePath,
    title: task.title === undefined || task.title.trim() === '' ? task.id : task.title,
    prompt: task.prompt,
    agentPreset: task.agentPreset,
    permissionPreset: task.permissionPreset,
  }
}

/**
 * Resolve every declared task, keeping per-task failures instead of failing the
 * whole set.
 *
 * A disabled task is neither armed nor reported as skipped: pausing a task is a
 * decision the author already made, not a problem to surface.
 * @param ctx - Loaded context carrying the services a task references.
 * @param tasks - Declared tasks, in author order.
 * @returns The arm set plus every enabled task that could not be armed.
 */
export async function resolveArmedTasks(ctx: Context, tasks: readonly SchedulerTask[]): Promise<ArmedTasks> {
  const armed: ResolvedSchedulerTask[] = []
  const skipped: SkippedTask[] = []
  for (const task of tasks) {
    if (task.enabled === false) continue
    try {
      armed.push(await resolveTask(ctx, task))
    } catch (error: unknown) {
      skipped.push({ id: task.id, reason: render(error) })
    }
  }
  return { armed, skipped }
}
