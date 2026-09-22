/**
 * Draft state for the Scheduler settings page.
 *
 * The page edits a local draft rather than writing through on every keystroke,
 * so a half-typed task is never persisted and one save submits one atomic
 * mutation. `revision` is the settings revision the draft began from, which
 * fences the write against a concurrent edit from another surface.
 */

import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'

/** One workspace the picker can offer. */
export interface SchedulerWorkspaceOption {
  /** Canonical absolute directory path. */
  readonly path: string
  /** Display name supplied by the workspace registry. */
  readonly name: string
}

/** Store state mirrored from the settings scope plus the local draft. */
export interface SchedulerTasksState {
  /** `loading` until the settings section resolves. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** The draft the form renders; replaced on load and on discard. */
  draft: SchedulerTask[]
  /** The last accepted section, kept so Discard can restore it. */
  saved: SchedulerTask[]
  /** Settings revision the draft began from, fencing one save. */
  revision: number
  /** Whether `draft` differs from `saved`. */
  dirty: boolean
  /** A save in flight. */
  saving: boolean
  /** Last save failure, cleared by the next save attempt. */
  error: string | undefined
  /** Workspaces the picker offers. */
  workspaces: SchedulerWorkspaceOption[]
  /** Agent presets the deployment configures, in roster order. */
  presets: { id: string; name: string }[]
  /** Permission preset names that do not require approval. */
  permissionPresets: { id: string; name: string }[]
}

/** Declared action shape giving the exported factory a stable return type. */
export type SchedulerTasksActions = {
  /** Replace the draft and saved baseline from one accepted section. */
  load: (draft: SchedulerTasksState, tasks: SchedulerTask[], revision: number, writable: boolean) => void
  /** Publish the unavailable state (no namespace exposed, or memory mode). */
  unavailable: (draft: SchedulerTasksState) => void
  /** Add one blank task and mark the draft dirty. */
  add: (draft: SchedulerTasksState) => void
  /** Remove one task by index. */
  remove: (draft: SchedulerTasksState, index: number) => void
  /** Patch one task by index; an `undefined` value clears the optional field. */
  patch: (draft: SchedulerTasksState, index: number, next: SchedulerPatch) => void
  /** Put the draft back to the last accepted section. */
  discard: (draft: SchedulerTasksState) => void
  /** Record that a save started. */
  saving: (draft: SchedulerTasksState) => void
  /** Record a save failure. */
  failed: (draft: SchedulerTasksState, message: string) => void
  /** Publish the picker options the page renders. */
  options: (
    draft: SchedulerTasksState,
    workspaces: SchedulerWorkspaceOption[],
    presets: { id: string; name: string }[],
    permissionPresets: { id: string; name: string }[],
  ) => void
}

/**
 * Fresh initial state for one page instance.
 * @returns the loading state one page starts from, with an empty draft and no picker options.
 */
export function initialSchedulerTasksState(): SchedulerTasksState {
  return {
    status: 'loading',
    writable: false,
    draft: [],
    saved: [],
    revision: 0,
    dirty: false,
    saving: false,
    error: undefined,
    workspaces: [],
    presets: [],
    permissionPresets: [],
  }
}

/** Copy a task list into plain mutable records. */
function copyTasks(tasks: readonly SchedulerTask[]): SchedulerTask[] {
  // Field-by-field rather than `structuredClone`: the store's drafts are
  // Immer-frozen, and structuredClone refuses a frozen proxy.
  return tasks.map(task => ({
    ...task,
    ...(task.weekdays === undefined ? {} : { weekdays: [...task.weekdays] }),
  }))
}

/** Whether two task lists hold the same tasks in the same order. */
function sameTasks(left: readonly SchedulerTask[], right: readonly SchedulerTask[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * One draft edit.
 *
 * Every field admits `undefined` explicitly: `Partial` under
 * `exactOptionalPropertyTypes` refuses `{ timeZone: undefined }`, and clearing
 * an optional field is exactly what the form's empty input does.
 */
export type SchedulerPatch = {
  [K in keyof SchedulerTask]?: SchedulerTask[K] | undefined
}

/**
 * The write surface the controller drives.
 *
 * Exported as its own table rather than reached through a store handle: the
 * controller owns a `createSnapshotStore` instance and applies these actions to
 * its draft, so a handle would add a second store nobody shares.
 */
export const schedulerTasksActions: SchedulerTasksActions = {
  load: (d, tasks, revision, writable) => {
    d.status = 'ready'
    d.writable = writable
    d.revision = revision
    d.draft = copyTasks(tasks)
    d.saved = copyTasks(tasks)
    d.dirty = false
    d.saving = false
    d.error = undefined
  },
  unavailable: (d) => {
    d.status = 'unavailable'
    d.writable = false
  },
  add: (d) => {
    d.draft = [...d.draft, blankTask(d.draft)]
    d.dirty = true
  },
  remove: (d, index) => {
    d.draft = d.draft.filter((_task, at) => at !== index)
    d.dirty = true
  },
  patch: (d, index, next) => {
    d.draft = d.draft.map((task, at) => {
      if (at !== index) return task
      // Rebuilt key by key rather than spread-and-delete: an explicit
      // `undefined` omits the key entirely, so the saved JSON keeps an omitted
      // optional field omitted instead of storing a null.
      const merged: Record<string, unknown> = {}
      for (const [key, value] of Object.entries({ ...task, ...next })) {
        if (value === undefined) continue
        merged[key] = value
      }
      return merged as unknown as SchedulerTask
    })
    d.dirty = !sameTasks(d.draft, d.saved)
  },
  discard: (d) => {
    d.draft = copyTasks(d.saved)
    d.dirty = false
    d.error = undefined
  },
  saving: (d) => {
    d.saving = true
    d.error = undefined
  },
  failed: (d, message) => {
    d.saving = false
    d.error = message
  },
  options: (d, workspaces, presets, permissionPresets) => {
    d.workspaces = workspaces
    d.presets = presets
    d.permissionPresets = permissionPresets
  },
}

/** Build one new task with a unique id, so the form opens on a valid draft. */
function blankTask(existing: readonly SchedulerTask[]): SchedulerTask {
  const taken = new Set(existing.map(task => task.id))
  let suffix = existing.length + 1
  while (taken.has(`task-${String(suffix)}`)) suffix += 1
  return {
    id: `task-${String(suffix)}`,
    enabled: true,
    // An empty path is what the form shows until a workspace is chosen; the
    // page's own validation refuses to save it.
    workspacePath: '',
    time: '09:00:00',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    prompt: '',
    permissionPreset: '',
  }
}
