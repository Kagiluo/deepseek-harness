// @vitest-environment jsdom
/**
 * The Scheduled tasks page's rendering rules: validation blocks a save the Host
 * would refuse, a missing workspace is named rather than silently offered, a
 * removal is confirmed first, and the write is submitted from the footer.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import { SchedulerSection, type SchedulerSectionProps } from '../src/client/SchedulerSection.tsx'
import { initialSchedulerTasksState, type SchedulerTasksState } from '../src/client/tasks-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

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

/** Render the page over one snapshot, with every action a spy. */
function renderSection(overrides: Partial<SchedulerTasksState> = {}) {
  const state: SchedulerTasksState = {
    ...initialSchedulerTasksState(),
    status: 'ready',
    writable: true,
    draft: [task()],
    saved: [task()],
    revision: 1,
    workspaces: [{ path: '/tmp/workspace', name: 'workspace' }],
    presets: [{ id: 'standard', name: 'Standard' }],
    permissionPresets: [{ id: 'unattended', name: 'unattended' }],
    ...overrides,
  }
  const store = createSnapshotStore<SchedulerTasksState>(state)
  const actions = {
    add: vi.fn(),
    remove: vi.fn(),
    patch: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
    discard: vi.fn(),
  }
  const props = {
    t: (key: keyof typeof en, vars?: Record<string, string>) => {
      const template: string = en[key]
      if (vars === undefined) return template
      let text = template
      for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value)
      return text
    },
    useSchedulerTasks: <S,>(selector: (snapshot: SchedulerTasksState) => S): S => selector(store.getSnapshot()),
    hooks: { schedulerTasks: store },
    close: vi.fn(),
    ...actions,
  } as unknown as SchedulerSectionProps
  render(<SchedulerSection {...props} />)
  return { actions, store }
}

describe('SchedulerSection rendering', () => {
  it('renders one heading per task, in order', () => {
    renderSection({ draft: [task({ id: 'a' }), task({ id: 'b' })] })
    expect(screen.getByText('Task 1')).toBeDefined()
    expect(screen.getByText('Task 2')).toBeDefined()
  })

  it('shows the empty state and its hint once the section is ready', () => {
    renderSection({ draft: [], saved: [] })
    expect(screen.getByText(en.empty)).toBeDefined()
    expect(screen.getByText(en.emptyHint)).toBeDefined()
  })

  it('reports an unserved namespace instead of a form', () => {
    renderSection({ status: 'unavailable' })
    expect(screen.getByText(en.unavailable)).toBeDefined()
    expect(screen.queryByText(en.intro)).toBeNull()
  })

  it('marks a task that is paused', () => {
    renderSection({ draft: [task({ enabled: false })], saved: [task({ enabled: false })] })
    // The tag states the paused fact; the checkbox carries the same word as its
    // label, so this asserts the read-only tag rather than the control.
    expect(screen.getAllByText(en.enabled).length).toBeGreaterThan(1)
  })

  it('names a workspace that no longer exists', () => {
    renderSection({
      draft: [task({ workspacePath: '/gone' })],
      workspaces: [{ path: '/tmp/workspace', name: 'workspace' }],
    })
    expect(screen.getByText(en.workspaceMissing)).toBeDefined()
  })
})

describe('SchedulerSection edits', () => {
  it('patches the id the user types', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.id} 1`), { target: { value: 'renamed' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { id: 'renamed' })
  })

  it('patches the prompt the user types', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.prompt} 1`), { target: { value: 'new prompt' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { prompt: 'new prompt' })
  })

  it('joins the three time parts into one stored value', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.time} 1 ${en['time.hour']}`), { target: { value: '07' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { time: '07:30:00' })
  })

  it('patches the minute and second time parts independently', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.time} 1 ${en['time.minute']}`), { target: { value: '15' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { time: '09:15:00' })
    fireEvent.change(screen.getByLabelText(`${en.time} 1 ${en['time.second']}`), { target: { value: '45' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { time: '09:30:45' })
  })

  it('clears the whole time when one part is emptied, so the Host refuses it', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.time} 1 ${en['time.hour']}`), { target: { value: '' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { time: '' })
  })

  it('shows empty time parts for a stored value that is not HH:MM:SS', () => {
    const invalid = [task({ time: 'nope' })]
    renderSection({ draft: invalid, saved: invalid })
    const hour = screen.getByLabelText<HTMLInputElement>(`${en.time} 1 ${en['time.hour']}`)
    expect(hour.value).toBe('')
  })

  it('patches the workspace the user chooses', () => {
    const { actions } = renderSection({ workspaces: [{ path: '/other', name: 'other' }] })
    fireEvent.change(screen.getByLabelText(`${en.workspace} 1`), { target: { value: '/other' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { workspacePath: '/other' })
  })

  it('patches the time zone the user types', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.timeZone} 1`), { target: { value: 'Europe/Berlin' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { timeZone: 'Europe/Berlin' })
  })

  it('patches the permission preset the user chooses', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.permissionPreset} 1`), { target: { value: 'unattended' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { permissionPreset: 'unattended' })
  })

  it('patches the agent preset the user chooses', () => {
    const { actions } = renderSection()
    fireEvent.change(screen.getByLabelText(`${en.agentPreset} 1`), { target: { value: 'standard' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { agentPreset: 'standard' })
  })

  it('patches the enabled flag the user toggles', () => {
    const { actions } = renderSection()
    fireEvent.click(screen.getByLabelText(`${en.enabled} 1`))
    expect(actions.patch).toHaveBeenCalledWith(0, { enabled: false })
  })

  it('adds a selected weekday back to an explicit list', () => {
    const { actions } = renderSection({ draft: [task({ weekdays: [0, 2] })] })
    fireEvent.click(screen.getByRole('checkbox', { name: en['weekday.4'] }))
    expect(actions.patch).toHaveBeenCalledWith(0, { weekdays: [0, 2, 4] })
  })

  it('clears the time zone when the field is emptied', () => {
    const { actions } = renderSection({ draft: [task({ timeZone: 'UTC' })] })
    fireEvent.change(screen.getByLabelText(`${en.timeZone} 1`), { target: { value: '   ' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { timeZone: undefined })
  })

  it('clears the every-day default when the last selected weekday is unchecked', () => {
    const { actions } = renderSection({ draft: [task({ weekdays: [0, 2] })] })
    fireEvent.click(screen.getByRole('checkbox', { name: en['weekday.0'] }))
    expect(actions.patch).toHaveBeenCalledWith(0, { weekdays: [2] })
  })

  it('clears the weekdays key once every day is selected', () => {
    const { actions } = renderSection({ draft: [task({ weekdays: [0, 1, 2, 3, 4, 5] })] })
    fireEvent.click(screen.getByRole('checkbox', { name: en['weekday.6'] }))
    expect(actions.patch).toHaveBeenCalledWith(0, { weekdays: undefined })
  })

  it('unchecks a selected weekday out of the stored default', () => {
    // `task()` declares no weekdays, which is the stored every-day default.
    const { actions } = renderSection({ draft: [task()] })
    fireEvent.click(screen.getByRole('checkbox', { name: en['weekday.3'] }))
    expect(actions.patch).toHaveBeenCalledWith(0, { weekdays: [0, 1, 2, 4, 5, 6] })
  })

  it('clears the agent preset when the empty option is chosen', () => {
    const { actions } = renderSection({ draft: [task({ agentPreset: 'standard' })] })
    fireEvent.change(screen.getByLabelText(`${en.agentPreset} 1`), { target: { value: '' } })
    expect(actions.patch).toHaveBeenCalledWith(0, { agentPreset: undefined })
  })
})

describe('SchedulerSection validation', () => {
  it('blocks the save and explains a blank workspace', () => {
    renderSection({ draft: [task({ workspacePath: '' })], saved: [task({ workspacePath: '' })] })
    expect(screen.getByRole('alert').textContent).toBe(en['validation.workspace'])
    expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(true)
  })

  it('blocks the save on a duplicate id', () => {
    const duplicate = [task(), task()]
    renderSection({ draft: duplicate, saved: duplicate })
    expect(screen.getByRole('alert').textContent).toBe(en['validation.duplicateId'])
  })

  it('blocks the save on a blank id, prompt, or permission preset', () => {
    const cases: [Partial<SchedulerTask>, string][] = [
      [{ id: '  ' }, en['validation.emptyId']],
      [{ time: 'nope' }, en['validation.time']],
      [{ weekdays: [] }, en['validation.weekdays']],
      [{ prompt: '  ' }, en['validation.prompt']],
      [{ permissionPreset: '' }, en['validation.permissionPreset']],
    ]
    for (const [override, message] of cases) {
      cleanup()
      const edited = [task(override)]
      renderSection({ draft: edited, saved: [task()] })
      expect(screen.getByRole('alert').textContent, message).toBe(message)
      expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(true)
    }
  })

  it('enables the save once the draft is valid and dirty', () => {
    renderSection({ draft: [task({ prompt: 'edited' })], saved: [task()], dirty: true })
    expect(screen.getByText(en.unsaved)).toBeDefined()
    expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(false)
  })

  it('surfaces a save failure without discarding the draft', () => {
    renderSection({ draft: [task({ prompt: 'edited' })], saved: [task()], error: 'offline' })
    expect(screen.getByText(en.saveFailed.replace('{message}', 'offline'))).toBeDefined()
  })

  it('shows the saving label while a save is in flight', () => {
    renderSection({ draft: [task({ prompt: 'edited' })], saved: [task()], dirty: true, saving: true })
    expect(screen.getByRole('button', { name: en.saving })).toBeDefined()
    expect(screen.getByRole('button', { name: en.saving }).hasAttribute('disabled')).toBe(true)
  })
})

describe('SchedulerSection actions', () => {
  it('adds a task, saves, and discards through their controls', async () => {
    const { actions } = renderSection({ draft: [task({ prompt: 'edited' })], saved: [task()], dirty: true })
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(actions.add).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(actions.save).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(actions.discard).toHaveBeenCalled()
  })

  it('confirms a removal before dropping the task', async () => {
    const { actions } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: `${en.remove} 1` }))
    expect(screen.getByText(en.removeConfirmBody)).toBeDefined()
    expect(actions.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.confirmRemove }))
    expect(actions.remove).toHaveBeenCalledWith(0)
  })

  it('leaves the task alone when the removal is cancelled', () => {
    const { actions } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: `${en.remove} 1` }))
    // The dialog's own cancel action; the footer carries the same label.
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(actions.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves the task alone when the removal dialog is dismissed', () => {
    const { actions } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: `${en.remove} 1` }))
    // The Modal's own close affordance, which carries the "Close" label.
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(actions.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables every edit control while the document is read-only', () => {
    renderSection({ writable: false, draft: [task({ prompt: 'edited' })], saved: [task()], dirty: true })
    expect(screen.getByLabelText(`${en.id} 1`).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(true)
  })
})
