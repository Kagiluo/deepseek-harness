/** The `scheduler` settings namespace schema and unattended-preset selection. */

import { describe, expect, it } from 'vitest'
import {
  SCHEDULER_SETTINGS_NAMESPACE, schedulerSettingsSchema, unattendedPresets,
  type SchedulerSettings,
} from '../src/settings.ts'

/** A task record the settings schema admits. */
const TASK = {
  id: 'daily',
  workspacePath: '/tmp/workspace',
  time: '09:30:00',
  prompt: 'do the thing',
  permissionPreset: 'unattended',
}

describe('SCHEDULER_SETTINGS_NAMESPACE', () => {
  it('is the lowercase hyphenated namespace the settings provider accepts', () => {
    expect(SCHEDULER_SETTINGS_NAMESPACE).toBe('scheduler')
  })
})

/**
 * Parse one untrusted section through a namespace schema.
 *
 * A schema's call signature takes the resolved value; every real caller feeds
 * it raw configuration or settings-document data, so this names that boundary
 * instead of asserting the input into shape.
 * @param schema - the built namespace schema.
 * @param input - unvalidated section data.
 * @returns the resolved section.
 */
function parse(schema: ReturnType<typeof schedulerSettingsSchema>, input: unknown): SchedulerSettings {
  return (schema as unknown as (data: unknown) => SchedulerSettings)(input)
}

describe('schedulerSettingsSchema', () => {
  it('defaults to an empty task list', () => {
    expect(parse(schedulerSettingsSchema(['unattended']), {})).toEqual({ tasks: [] })
  })

  it('fills the every-day default onto a stored task', () => {
    const resolved = parse(schedulerSettingsSchema(['unattended']), { tasks: [TASK] })
    expect(resolved.tasks[0]?.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('accepts each advertised unattended preset', () => {
    const schema = schedulerSettingsSchema(['unattended', 'full-access'])
    expect(parse(schema, { tasks: [{ ...TASK, permissionPreset: 'full-access' }] }).tasks[0]?.permissionPreset)
      .toBe('full-access')
  })

  it('refuses a preset this deployment does not advertise as unattended', () => {
    const schema = schedulerSettingsSchema(['unattended'])
    expect(() => parse(schema, { tasks: [{ ...TASK, permissionPreset: 'ask-each-time' }] })).toThrow()
  })

  it('falls back to a plain string when no preset is eligible', () => {
    // A deployment mounting no permission service still registers the namespace;
    // arm-time validation is what names the real problem.
    const schema = schedulerSettingsSchema([])
    expect(parse(schema, { tasks: [{ ...TASK, permissionPreset: 'anything' }] }).tasks[0]?.permissionPreset)
      .toBe('anything')
  })

  it('requires the id, workspace, time, prompt, and permission preset', () => {
    const schema = schedulerSettingsSchema(['unattended'])
    const required = ['id', 'workspacePath', 'time', 'prompt', 'permissionPreset'] as const
    for (const field of required) {
      const without = Object.fromEntries(
        Object.entries(TASK).filter(([key]) => key !== field),
      )
      expect(() => parse(schema, { tasks: [without] }), field).toThrow()
    }
  })

  it('keeps an omitted optional field omitted rather than storing a null', () => {
    const resolved = parse(schedulerSettingsSchema(['unattended']), { tasks: [TASK] })
    expect(resolved.tasks[0]).not.toHaveProperty('timeZone')
    expect(resolved.tasks[0]).not.toHaveProperty('agentPreset')
    expect(resolved.tasks[0]).not.toHaveProperty('title')
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
