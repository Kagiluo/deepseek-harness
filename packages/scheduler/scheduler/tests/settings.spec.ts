/**
 * The `scheduler` settings entry: its namespace id, the task record schema the
 * plugin `Config` is built from, and unattended-preset selection.
 */

import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { SCHEDULER_SETTINGS_NAMESPACE, taskSchema, unattendedPresets } from '../src/settings.ts'
import type { SchedulerTask } from '../src/types.ts'

/** A task record the task schema admits. */
const TASK = {
  id: 'daily',
  workspacePath: '/tmp/workspace',
  time: '09:30:00',
  prompt: 'do the thing',
  permissionPreset: 'unattended',
}

/**
 * Parse one untrusted task through the task record schema.
 *
 * A schema's call signature takes the resolved value; every real caller feeds
 * it raw configuration or settings-document data, so this names that boundary
 * instead of asserting the input into shape.
 * @param input - unvalidated task data.
 * @returns the resolved task record.
 */
function parse(input: unknown): SchedulerTask {
  return (taskSchema(z.string().required()) as unknown as (data: unknown) => SchedulerTask)(input)
}

describe('SCHEDULER_SETTINGS_NAMESPACE', () => {
  it('is the Loader entry id owning the settings section', () => {
    expect(SCHEDULER_SETTINGS_NAMESPACE).toBe('scheduler')
  })
})

describe('taskSchema', () => {
  it('fills the every-day default onto a stored task', () => {
    expect(parse(TASK).weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('admits any preset name, leaving the approval policy to arm time', () => {
    // The eligible set depends on the permission table mounted at that moment,
    // so the stored record keeps a plain name and `resolveTask` refuses a
    // preset that asks when the task is armed.
    expect(parse({ ...TASK, permissionPreset: 'ask-each-time' }).permissionPreset).toBe('ask-each-time')
  })

  it('requires the id, workspace, time, prompt, and permission preset', () => {
    const required = ['id', 'workspacePath', 'time', 'prompt', 'permissionPreset'] as const
    for (const field of required) {
      const without = Object.fromEntries(
        Object.entries(TASK).filter(([key]) => key !== field),
      )
      expect(() => parse(without), field).toThrow()
    }
  })

  it('keeps an omitted optional field omitted rather than storing a null', () => {
    const resolved = parse(TASK)
    expect(resolved).not.toHaveProperty('timeZone')
    expect(resolved).not.toHaveProperty('agentPreset')
    expect(resolved).not.toHaveProperty('title')
  })
})

describe('unattendedPresets', () => {
  it('keeps only the presets whose approval policy never asks', () => {
    const specs: Record<string, string> = {
      unattended: 'never',
      'full-access': 'never',
      standard: 'ask',
    }
    expect(unattendedPresets(Object.keys(specs), name => ({ approval: specs[name] as string })))
      .toEqual(['unattended', 'full-access'])
  })

  it('drops a name the table cannot resolve', () => {
    expect(unattendedPresets(['ghost', 'unattended'], (name) => {
      if (name === 'ghost') throw new Error('unknown preset')
      return { approval: 'never' }
    })).toEqual(['unattended'])
  })

  it('returns nothing for a table with no eligible preset', () => {
    expect(unattendedPresets(['standard'], () => ({ approval: 'ask' }))).toEqual([])
  })
})
