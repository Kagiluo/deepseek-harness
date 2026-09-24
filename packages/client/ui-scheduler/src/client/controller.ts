/**
 * Apply-world controller for the Scheduled tasks page.
 *
 * Owns the draft in a snapshot store, keeps it mirrored from the `scheduler`
 * configuration form and two Host catalogs, and performs the one atomic write
 * the page submits. The component never touches `ctx`: it reads the store
 * through the bound `useSchedulerTasks` seat and calls the callbacks this
 * controller exposes.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import {
  initialSchedulerTasksState, schedulerTasksActions as actions,
  type SchedulerPatch, type SchedulerTasksState, type SchedulerWorkspaceOption,
} from './tasks-store.ts'

/** The `scheduler` entry's section: the task list this page reads and writes. */
export interface SchedulerSection {
  /** Tasks the host resolves over the composition base and the stored user layer. */
  tasks: SchedulerTask[]
}

/** Catalog readers the pickers need, supplied by the apply closure. */
export interface SchedulerCatalogues {
  /** Workspaces the deployment registers. */
  workspaces: () => SchedulerWorkspaceOption[]
  /** Agent presets the roster configures, in roster order. */
  presets: () => Promise<{ id: string; name: string }[]>
  /** Permission presets the host advertises, in catalog order. */
  permissionPresets: () => Promise<{ id: string; name: string }[]>
}

/** Controls one mounted Scheduler settings page. */
export class SchedulerTasksController {
  /** Draft and status the page renders through `useSchedulerTasks`. */
  private readonly store = createSnapshotStore(initialSchedulerTasksState())

  /**
   * Construct the controller over the `scheduler` entry's configuration form.
   * @param scope - the configuration form bound to the `scheduler` Host entry.
   * @param catalogues - Host catalog readers for the three pickers.
   */
  constructor(
    private readonly scope: ConfigForm<SchedulerSection>,
    private readonly catalogues: SchedulerCatalogues,
  ) {}

  /** Read the store's bare observable source for the inject `hooks` compartment. */
  get source(): SnapshotStore<SchedulerTasksState> {
    return this.store
  }

  /**
   * Subscribe to the configuration form so every committed change refreshes the
   * draft, and publish the initial projection.
   * @returns the disposer removing the subscription.
   */
  start(): () => void {
    this.refresh()
    return this.scope.subscribe(() => { this.refresh() })
  }

  /**
   * Refresh the picker catalogs, which come from Host reads rather than from the
   * settings document.
   * @returns fulfillment after the asynchronous catalog reads settle.
   */
  async refreshCatalogues(): Promise<void> {
    // A refused read leaves its picker with no options rather than failing the
    // page: an agent preset is optional on most tasks, and a deployment with no
    // permission service advertises no preset.
    const presets = await this.catalogues.presets().catch(() => [])
    const permissionPresets = await this.catalogues.permissionPresets().catch(() => [])
    this.store.update((draft) => {
      actions.options(draft, this.catalogues.workspaces(), presets, permissionPresets)
    })
  }

  /** Project the configuration form onto the draft the page renders. */
  private refresh(): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status === 'unavailable') {
      this.store.update((draft) => { actions.unavailable(draft) })
      return
    }
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    const revision = snapshot.revision ?? 0
    // An in-progress edit is never overwritten by a background refresh, and its
    // fence is NOT advanced: keeping the revision the draft began from is what
    // makes a concurrent commit from another surface a refused write rather
    // than a silent overwrite. `save` adopts the newer revision only after a
    // refusal, so a retry can land.
    if (this.store.getSnapshot().dirty) return
    const { tasks } = snapshot.value
    this.store.update((draft) => { actions.load(draft, tasks, revision, snapshot.writable) })
  }

  /** Add one blank task to the draft. */
  add(): void {
    this.store.update((draft) => { actions.add(draft) })
  }

  /**
   * Remove one task from the draft.
   * @param index - position in the draft.
   */
  remove(index: number): void {
    this.store.update((draft) => { actions.remove(draft, index) })
  }

  /**
   * Patch one task in the draft.
   * @param index - position in the draft.
   * @param next - the fields to change; an `undefined` value clears the field.
   */
  patch(index: number, next: SchedulerPatch): void {
    this.store.update((draft) => { actions.patch(draft, index, next) })
  }

  /** Restore the draft to the last saved list. */
  discard(): void {
    this.store.update((draft) => { actions.discard(draft) })
  }

  /**
   * Write the whole draft as one atomic mutation.
   *
   * The fence is the revision the draft began from, so a change committed on
   * another surface is refused rather than silently overwritten. The settings
   * wire replaces an array wholesale, which is why the page submits the entire
   * list instead of per-task operations.
   *
   * `mutate` resolves even when the Host refuses the write — it reloads its own
   * state instead of rejecting — so success is decided by whether the accepted
   * document now holds what was submitted. Reading that, rather than trusting
   * resolution, is what keeps a refused save editable instead of discarding the
   * draft and reporting it as stored.
   * @returns fulfillment after the write settles, whatever its outcome.
   */
  async save(): Promise<void> {
    const before = this.store.getSnapshot()
    if (!before.dirty || before.saving || !before.writable) return
    // A plain copy, not `structuredClone`: the store's drafts are Immer-frozen
    // and structuredClone refuses a frozen proxy. The weekday list is copied so
    // the wire carries a plain JSON array rather than the task's read-only one.
    const submitted = before.draft.map(task => {
      const { weekdays, ...rest } = task
      return { ...rest, ...(weekdays === undefined ? {} : { weekdays: [...weekdays] }) }
    })
    this.store.update((draft) => { actions.saving(draft) })
    try {
      await this.scope.mutate([{ op: 'set', path: ['tasks'], value: submitted }], before.revision)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.update((draft) => { actions.failed(draft, message) })
      return
    }
    const accepted = this.scope.getSnapshot().value?.tasks
    const revision = this.scope.getSnapshot().revision ?? before.revision
    if (accepted === undefined || !sameTaskList(accepted, submitted)) {
      // The Host kept a different document: the write was refused (a stale
      // fence) or the namespace went away. The edit stays in the draft so the
      // user can retry it against the refreshed revision.
      this.store.update((draft) => {
        draft.revision = revision
        actions.failed(draft, 'the host did not accept this change')
      })
      return
    }
    this.store.update((draft) => { actions.load(draft, [...accepted], revision, true) })
  }
}

/**
 * Whether the accepted document holds exactly the submitted task list.
 * @param accepted - the tasks the Host now reports.
 * @param submitted - the tasks this page sent.
 * @returns whether the write landed.
 */
function sameTaskList(accepted: readonly SchedulerTask[], submitted: readonly SchedulerTask[]): boolean {
  return JSON.stringify(accepted) === JSON.stringify(submitted)
}
