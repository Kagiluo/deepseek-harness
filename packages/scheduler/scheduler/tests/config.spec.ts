/** Task validation split by what can change while the process runs. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SchedulerConfigError, resolveArmedTasks, validateTaskStructure } from '../src/config.ts'
import type { SchedulerTask } from '../src/types.ts'

let root: string
let workspace: string
let missing: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-scheduler-config-'))
  workspace = join(root, 'workspace')
  missing = join(root, 'gone')
  writeFileSync(join(root, 'file.txt'), 'not a directory')
  mkdirSync(workspace)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** One task with the fields a test does not vary filled in. */
function task(overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: 'daily',
    workspacePath: workspace,
    time: '09:30:00',
    timeZone: 'UTC',
    prompt: 'do the thing',
    permissionPreset: 'unattended',
    ...overrides,
  }
}

/** A context whose permission table and optional roster the caller controls. */
function context(options: {
  approval?: string
  withRoster?: boolean
  rosterRoots?: number
} = {}): Context {
  const ctx = new Context()
  const approval = options.approval ?? 'never'
  ctx.provide('permissionPresets', {
    names: ['unattended'],
    resolve: () => ({ approval }),
  } as never)
  if (options.withRoster === true) {
    ctx.provide('agentPresets', {
      // The registry advertises its roster through `list()`; its length is what
      // decides whether a task must name a preset.
      list: async () => Array.from({ length: options.rosterRoots ?? 1 }, (_unused, index) => ({ id: `preset-${String(index)}` })),
      resolve: async (id?: string) => ({ id: id ?? 'standard' }),
    } as never)
  }
  return ctx
}

describe('validateTaskStructure', () => {
  it('accepts a well-formed task list', () => {
    expect(() =>{  validateTaskStructure([task()]) }).not.toThrow()
  })

  it('accepts an empty list', () => {
    expect(() =>{  validateTaskStructure([]) }).not.toThrow()
  })

  it('refuses a blank id', () => {
    expect(() =>{  validateTaskStructure([task({ id: '  ' })]) })
      .toThrow(/task #1 id must be a non-empty string/)
  })

  it('refuses a duplicate id', () => {
    expect(() =>{  validateTaskStructure([task(), task()]) })
      .toThrow(/duplicate scheduler task id "daily"/)
  })

  it('refuses a relative workspace path', () => {
    expect(() =>{  validateTaskStructure([task({ workspacePath: 'relative/dir' })]) })
      .toThrow(/workspacePath must be absolute/)
  })

  it('refuses a blank prompt', () => {
    expect(() =>{  validateTaskStructure([task({ prompt: '' })]) })
      .toThrow(/prompt must be a non-empty string/)
  })

  it('refuses a blank permission preset', () => {
    expect(() =>{  validateTaskStructure([task({ permissionPreset: '' })]) })
      .toThrow(/permissionPreset must be a non-empty string/)
  })

  it('refuses an unusable time', () => {
    expect(() =>{  validateTaskStructure([task({ time: '9am' })]) })
      .toThrow(/is not a valid daily schedule/)
  })

  it('names the failing task by position and id', () => {
    expect(() =>{  validateTaskStructure([task(), task({ id: 'second', time: 'nope' })]) })
      .toThrow(/scheduler task "second"/)
  })

  it('does not check the workspace directory, which can disappear later', () => {
    expect(() =>{  validateTaskStructure([task({ workspacePath: missing })]) }).not.toThrow()
  })
})

describe('resolveArmedTasks', () => {
  it('arms a fully resolvable task', async () => {
    const result = await resolveArmedTasks(context(), [task()])
    expect(result.skipped).toEqual([])
    expect(result.armed).toHaveLength(1)
    expect(result.armed[0]).toMatchObject({
      workspacePath: workspace,
      title: 'daily',
      prompt: 'do the thing',
      permissionPreset: 'unattended',
      agentPreset: undefined,
    })
  })

  it('uses an explicit title over the task id', async () => {
    const result = await resolveArmedTasks(context(), [task({ title: 'Nightly report' })])
    expect(result.armed[0]?.title).toBe('Nightly report')
  })

  it('falls back to the id for a blank title', async () => {
    const result = await resolveArmedTasks(context(), [task({ title: '   ' })])
    expect(result.armed[0]?.title).toBe('daily')
  })

  it('skips only the task whose workspace is gone', async () => {
    const result = await resolveArmedTasks(context(), [task({ id: 'gone', workspacePath: missing }), task()])
    expect(result.armed.map(entry => entry.schedule.taskId)).toEqual(['daily'])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.id).toBe('gone')
    expect(result.skipped[0]?.reason).toMatch(/is not an existing directory/)
  })

  it('skips a task whose workspace path is a file', async () => {
    const result = await resolveArmedTasks(context(), [task({ workspacePath: join(root, 'file.txt') })])
    expect(result.skipped[0]?.reason).toMatch(/is not an existing directory/)
  })

  it('refuses a preset that would ask a person for approval', async () => {
    const result = await resolveArmedTasks(context({ approval: 'ask' }), [task()])
    expect(result.armed).toEqual([])
    expect(result.skipped[0]?.reason).toMatch(/would park indefinitely/)
  })

  it('never reports a paused task, however unusable its references', async () => {
    const result = await resolveArmedTasks(context(), [
      task({ enabled: false, workspacePath: missing, permissionPreset: 'nope' }),
    ])
    expect(result.armed).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('requires an agent preset when the deployment configures a roster', async () => {
    const result = await resolveArmedTasks(context({ withRoster: true }), [task()])
    expect(result.skipped[0]?.reason).toMatch(/must declare agentPreset/)
  })

  it('arms a task naming a preset the roster resolves', async () => {
    const result = await resolveArmedTasks(context({ withRoster: true }), [task({ agentPreset: 'standard' })])
    expect(result.armed[0]?.agentPreset).toBe('standard')
    expect(result.skipped).toEqual([])
  })

  it('refuses an agent preset where no roster is configured', async () => {
    const result = await resolveArmedTasks(context(), [task({ agentPreset: 'standard' })])
    expect(result.skipped[0]?.reason).toMatch(/configures no agent preset roster/)
  })

  it('treats a mounted but empty roster as no roster', async () => {
    const result = await resolveArmedTasks(context({ withRoster: true, rosterRoots: 0 }), [task()])
    expect(result.armed).toHaveLength(1)
    expect(result.skipped).toEqual([])
  })

  it('keeps the declared arm order', async () => {
    const result = await resolveArmedTasks(context(), [
      task({ id: 'first' }), task({ id: 'second' }), task({ id: 'third' }),
    ])
    expect(result.armed.map(entry => entry.schedule.taskId)).toEqual(['first', 'second', 'third'])
  })

  it('reports a config error type for a failed reference', async () => {
    await expect(resolveArmedTasks(context(), [task({ workspacePath: missing })]))
      .resolves.toMatchObject({ skipped: [{ id: 'daily' }] })
    expect(new SchedulerConfigError('x')).toBeInstanceOf(Error)
  })

  it('renders a non-Error refusal from a referenced service verbatim', async () => {
    const ctx = new Context()
    ctx.provide('permissionPresets', {
      names: ['unattended'],
      // A provider that refuses with a bare string is reported as written, not
      // squeezed into an unhelpful "[object Object]".
      resolve: () => { throw 'preset table unavailable' },
    } as never)
    const result = await resolveArmedTasks(ctx, [task()])
    expect(result.skipped[0]?.reason).toBe('preset table unavailable')
  })
})
