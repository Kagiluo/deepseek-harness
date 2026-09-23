/**
 * The page controller: mirroring the settings scope, fencing one atomic write,
 * and keeping a refused save editable.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SchedulerTasksController, type SchedulerCatalogues } from '../src/client/controller.ts'

/** The section the page reads and writes. */
interface Section { tasks: SchedulerTask[] }

/** One stored task. */
function task(overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: 'daily',
    workspacePath: '/tmp/workspace',
    time: '09:30:00',
    prompt: 'do the thing',
    permissionPreset: 'unattended',
    ...overrides,
  }
}

/** A settings scope whose accepted document the test controls. */
class FakeScope implements SettingsScope<Section> {
  snapshot: SettingsScopeSnapshot<Section>
  readonly listeners = new Set<() => void>()
  readonly mutations: { ops: readonly unknown[]; revision: number | undefined }[] = []
  /** When set, the accepted document becomes this instead of what was submitted. */
  refuseWith: Section | undefined

  constructor(initial: Partial<SettingsScopeSnapshot<Section>> = {}) {
    this.snapshot = {
      status: 'ready',
      value: { tasks: [task()] },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
      ...initial,
    }
  }

  getSnapshot(): SettingsScopeSnapshot<Section> { return this.snapshot }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(ops: readonly unknown[], expectedRevision?: number): Promise<void> {
    this.mutations.push({ ops, revision: expectedRevision })
    // The real wire replaces the addressed field's value, so the accepted
    // section is the submitted array wrapped back under `tasks`.
    const submitted: Section = { tasks: (ops[0] as { value: SchedulerTask[] }).value }
    this.accept(this.refuseWith ?? submitted, (expectedRevision ?? 0) + 1)
  }

  async set(): Promise<void> { /* the page submits whole-list mutations */ }

  async unset(): Promise<void> { /* the page submits whole-list mutations */ }

  /** Publish a newly accepted document the way the real scope does. */
  accept(value: Section, revision: number): void {
    this.snapshot = { ...this.snapshot, value, revision, status: 'ready' }
    for (const listener of this.listeners) listener()
  }
}

/** Catalog readers the pickers use. */
const CATALOGUES: SchedulerCatalogues = {
  workspaces: () => [{ path: '/tmp/workspace', name: 'workspace' }],
  presets: async () => [{ id: 'standard', name: 'Standard' }],
  permissionPresets: () => [{ id: 'unattended', name: 'unattended' }],
}

describe('SchedulerTasksController projection', () => {
  it('publishes the accepted section as the draft', () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    const state = controller.source.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.draft).toEqual([task()])
    expect(state.revision).toBe(1)
    expect(state.writable).toBe(true)
  })

  it('reports an unserved namespace as unavailable', () => {
    const scope = new FakeScope({ status: 'unavailable', value: undefined })
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    expect(controller.source.getSnapshot().status).toBe('unavailable')
  })

  it('keeps loading while the scope has no answer yet', () => {
    const scope = new FakeScope({ status: 'loading', value: undefined })
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    expect(controller.source.getSnapshot().status).toBe('loading')
  })

  it('treats an absent revision as zero, so a save still carries a fence', async () => {
    const scope = new FakeScope({ revision: undefined })
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    expect(controller.source.getSnapshot().revision).toBe(0)
  })

  it('falls back to the draft revision when the scope never reports one', async () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    // The accepted read reports no revision, so the draft's own fence stands.
    vi.spyOn(scope, 'mutate').mockImplementationOnce(async () => {
      scope.snapshot = { ...scope.snapshot, value: { tasks: [task({ prompt: 'edited' })] }, revision: undefined }
    })
    await controller.save()
    expect(controller.source.getSnapshot().dirty).toBe(false)
  })

  it('refreshes when the scope publishes a new document', () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    scope.accept({ tasks: [task({ id: 'second' })] }, 2)
    expect(controller.source.getSnapshot().draft.map(entry => entry.id)).toEqual(['second'])
    expect(controller.source.getSnapshot().revision).toBe(2)
  })

  it('never overwrites an in-progress edit with a background refresh', () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'my edit' })
    scope.accept({ tasks: [task({ prompt: 'from elsewhere' })] }, 2)
    const state = controller.source.getSnapshot()
    expect(state.draft[0]?.prompt).toBe('my edit')
    // The fence stays at the revision the draft began from, so the concurrent
    // commit is refused rather than silently overwritten.
    expect(state.revision).toBe(1)
  })

  it('stops mirroring once the returned disposer runs', () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    const stop = controller.start()
    stop()
    scope.accept({ tasks: [task({ id: 'later' })] }, 2)
    expect(controller.source.getSnapshot().draft.map(entry => entry.id)).toEqual(['daily'])
  })
})

describe('SchedulerTasksController edits', () => {
  it('adds, removes, patches, and discards through the draft', () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.add()
    expect(controller.source.getSnapshot().draft).toHaveLength(2)
    controller.patch(0, { prompt: 'edited' })
    expect(controller.source.getSnapshot().draft[0]?.prompt).toBe('edited')
    controller.remove(1)
    expect(controller.source.getSnapshot().draft).toHaveLength(1)
    controller.discard()
    expect(controller.source.getSnapshot().draft).toEqual([task()])
    expect(controller.source.getSnapshot().dirty).toBe(false)
  })

  it('publishes the picker catalogs and survives a refused roster read', async () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, {
      ...CATALOGUES,
      presets: async () => { throw new Error('roster unavailable') },
    })
    await controller.refreshCatalogues()
    const state = controller.source.getSnapshot()
    expect(state.workspaces).toEqual([{ path: '/tmp/workspace', name: 'workspace' }])
    expect(state.permissionPresets).toEqual([{ id: 'unattended', name: 'unattended' }])
    // An optional agent preset simply leaves the picker without options.
    expect(state.presets).toEqual([])
  })
})

describe('SchedulerTasksController.save', () => {
  it('submits the whole list as one mutation fenced by the draft revision', async () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    expect(scope.mutations).toHaveLength(1)
    expect(scope.mutations[0]?.revision).toBe(1)
    expect(scope.mutations[0]?.ops).toEqual([
      { op: 'set', path: ['tasks'], value: [task({ prompt: 'edited' })] },
    ])
    const state = controller.source.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.draft[0]?.prompt).toBe('edited')
  })

  it('does nothing when the draft is clean', async () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    await controller.save()
    expect(scope.mutations).toEqual([])
  })

  it('does nothing when the document is read-only', async () => {
    const scope = new FakeScope({ writable: false })
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    expect(scope.mutations).toEqual([])
  })

  it('drops a second submit while one is in flight', async () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    const first = controller.save()
    const second = controller.save()
    await Promise.all([first, second])
    expect(scope.mutations).toHaveLength(1)
  })

  it('records a rejected mutation and keeps the edit', async () => {
    const scope = new FakeScope()
    vi.spyOn(scope, 'mutate').mockRejectedValueOnce(new Error('offline'))
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    const state = controller.source.getSnapshot()
    expect(state.error).toBe('offline')
    expect(state.saving).toBe(false)
    expect(state.dirty).toBe(true)
    expect(state.draft[0]?.prompt).toBe('edited')
  })

  it('reports a non-Error rejection as written', async () => {
    const scope = new FakeScope()
    vi.spyOn(scope, 'mutate').mockRejectedValueOnce('gateway closed')
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    expect(controller.source.getSnapshot().error).toBe('gateway closed')
  })

  it('copies the weekday list so a later edit cannot reach the submitted value', async () => {
    const scope = new FakeScope({ value: { tasks: [task({ weekdays: [1, 2] })] } })
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    const submitted = (scope.mutations[0]?.ops as { value: SchedulerTask[] }[])[0]?.value
    // The submitted list is a copy: mutating it cannot reach the stored draft.
    submitted![0]?.weekdays?.push(5)
    expect(controller.source.getSnapshot().draft[0]?.weekdays).toEqual([1, 2])
  })

  it('keeps the edit editable when the host keeps a different document', async () => {
    const scope = new FakeScope()
    scope.refuseWith = { tasks: [task({ prompt: 'someone else won' })] }
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    const state = controller.source.getSnapshot()
    expect(state.error).toBe('the host did not accept this change')
    expect(state.dirty).toBe(true)
    expect(state.draft[0]?.prompt).toBe('edited')
    // The fence advances so a retry against the newer revision can land.
    expect(state.revision).toBe(2)
  })

  it('retries successfully after adopting the refused revision', async () => {
    const scope = new FakeScope()
    scope.refuseWith = { tasks: [task({ prompt: 'someone else won' })] }
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    await controller.save()
    scope.refuseWith = undefined
    await controller.save()
    expect(controller.source.getSnapshot().dirty).toBe(false)
    expect(controller.source.getSnapshot().draft[0]?.prompt).toBe('edited')
  })

  it('reports a namespace that went away as a refused write', async () => {
    const scope = new FakeScope()
    const controller = new SchedulerTasksController(scope, CATALOGUES)
    controller.start()
    controller.patch(0, { prompt: 'edited' })
    vi.spyOn(scope, 'mutate').mockImplementationOnce(async () => {
      scope.snapshot = { ...scope.snapshot, value: undefined, status: 'loading' }
    })
    await controller.save()
    expect(controller.source.getSnapshot().error).toBe('the host did not accept this change')
    expect(controller.source.getSnapshot().dirty).toBe(true)
  })
})
