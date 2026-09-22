/**
 * Draft-store actions for the Scheduled tasks page: adding, patching, discarding,
 * and the optional-field omission rule that keeps a cleared field cleared.
 */

import { describe, expect, it } from 'vitest'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import {
  initialSchedulerTasksState, schedulerTasksActions as actions,
} from '../src/client/tasks-store.ts'

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

describe('initialSchedulerTasksState', () => {
  it('starts loading with an empty draft', () => {
    const state = initialSchedulerTasksState()
    expect(state).toMatchObject({
      status: 'loading',
      writable: false,
      draft: [],
      saved: [],
      revision: 0,
      dirty: false,
      saving: false,
      error: undefined,
    })
  })
})

describe('schedulerTasksActions.load', () => {
  it('publishes the accepted section as both draft and baseline', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task({ weekdays: [1, 2] })], 7, true)
    expect(state.status).toBe('ready')
    expect(state.revision).toBe(7)
    expect(state.writable).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.draft).toEqual([task({ weekdays: [1, 2] })])
    expect(state.saved).toEqual(state.draft)
  })

  it('copies each task so a later edit cannot reach the saved baseline', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task({ weekdays: [1] })], 1, true)
    actions.patch(state, 0, { workspacePath: '/elsewhere' })
    expect(state.saved[0]?.workspacePath).toBe('/tmp/workspace')
    expect(state.draft[0]?.workspacePath).toBe('/elsewhere')
  })

  it('copies the weekdays array, not the array itself', () => {
    const weekdays = [1, 2]
    const state = initialSchedulerTasksState()
    actions.load(state, [task({ weekdays })], 1, true)
    weekdays.push(3)
    expect(state.draft[0]?.weekdays).toEqual([1, 2])
  })
})

describe('schedulerTasksActions.add', () => {
  it('appends a unique, valid-looking task and marks the draft dirty', () => {
    const state = initialSchedulerTasksState()
    actions.add(state)
    expect(state.dirty).toBe(true)
    expect(state.draft).toHaveLength(1)
    expect(state.draft[0]).toMatchObject({
      id: 'task-1',
      enabled: true,
      workspacePath: '',
      time: '09:00:00',
      prompt: '',
      permissionPreset: '',
    })
  })

  it('skips an id already taken', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task({ id: 'task-1' })], 1, true)
    actions.add(state)
    expect(state.draft[1]?.id).toBe('task-2')
  })

  it('keeps advancing until it finds a free id', () => {
    // Three tasks, so the length-derived candidate is `task-4`; that id is
    // taken, so the search advances before it lands on `task-5`.
    const state = initialSchedulerTasksState()
    actions.load(state, [
      task({ id: 'task-1' }), task({ id: 'task-2' }), task({ id: 'task-4' }),
    ], 1, true)
    actions.add(state)
    expect(state.draft[3]?.id).toBe('task-5')
    expect(new Set(state.draft.map(entry => entry.id)).size).toBe(state.draft.length)
  })
})

describe('schedulerTasksActions.patch', () => {
  it('changes only the targeted task', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task(), task({ id: 'second' })], 1, true)
    actions.patch(state, 1, { prompt: 'changed' })
    expect(state.draft[0]?.prompt).toBe('do the thing')
    expect(state.draft[1]?.prompt).toBe('changed')
  })

  it('omits a field cleared with undefined instead of storing an explicit undefined', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task({ timeZone: 'UTC', agentPreset: 'standard' })], 1, true)
    actions.patch(state, 0, { timeZone: undefined, agentPreset: undefined })
    expect(state.draft[0]).not.toHaveProperty('timeZone')
    expect(state.draft[0]).not.toHaveProperty('agentPreset')
    expect(Object.hasOwn(state.draft[0] as object, 'timeZone')).toBe(false)
  })

  it('marks the draft clean again once it matches the baseline', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task()], 1, true)
    actions.patch(state, 0, { prompt: 'changed' })
    expect(state.dirty).toBe(true)
    actions.patch(state, 0, { prompt: 'do the thing' })
    expect(state.dirty).toBe(false)
  })

  it('ignores an out-of-range index', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task()], 1, true)
    actions.patch(state, 5, { prompt: 'nowhere' })
    expect(state.draft).toEqual([task()])
  })
})

describe('schedulerTasksActions.remove', () => {
  it('removes exactly the indexed task and marks the draft dirty', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task({ id: 'first' }), task({ id: 'second' })], 1, true)
    actions.remove(state, 0)
    expect(state.draft.map(entry => entry.id)).toEqual(['second'])
    expect(state.dirty).toBe(true)
  })
})

describe('schedulerTasksActions.discard', () => {
  it('restores the baseline and clears the failure', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task()], 1, true)
    actions.patch(state, 0, { prompt: 'changed' })
    actions.failed(state, 'boom')
    actions.discard(state)
    expect(state.draft).toEqual([task()])
    expect(state.dirty).toBe(false)
    expect(state.error).toBeUndefined()
    expect(state.saving).toBe(false)
  })
})

describe('schedulerTasksActions save bookkeeping', () => {
  it('records a start and then a failure', () => {
    const state = initialSchedulerTasksState()
    actions.load(state, [task()], 1, true)
    actions.patch(state, 0, { prompt: 'changed' })
    actions.saving(state)
    expect(state.saving).toBe(true)
    expect(state.error).toBeUndefined()
    actions.failed(state, 'the host refused')
    expect(state.saving).toBe(false)
    expect(state.error).toBe('the host refused')
  })
})

describe('schedulerTasksActions.unavailable', () => {
  it('reports an unserved namespace', () => {
    const state = initialSchedulerTasksState()
    actions.unavailable(state)
    expect(state.status).toBe('unavailable')
    expect(state.writable).toBe(false)
  })
})

describe('schedulerTasksActions.options', () => {
  it('publishes the three picker catalogs', () => {
    const state = initialSchedulerTasksState()
    actions.options(
      state,
      [{ path: '/tmp/workspace', name: 'workspace' }],
      [{ id: 'standard', name: 'Standard' }],
      [{ id: 'unattended', name: 'unattended' }],
    )
    expect(state.workspaces).toEqual([{ path: '/tmp/workspace', name: 'workspace' }])
    expect(state.presets).toEqual([{ id: 'standard', name: 'Standard' }])
    expect(state.permissionPresets).toEqual([{ id: 'unattended', name: 'unattended' }])
  })
})
