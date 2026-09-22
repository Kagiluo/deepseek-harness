/** Pure daily wall-clock resolution: validation, next occurrence, and DST behavior. */

import { describe, expect, it } from 'vitest'
import {
  SchedulerTimeError, nextOccurrence, resolveDailySchedule, resolveTimeZone,
} from '../src/time.ts'
import type { SchedulerTask } from '../src/types.ts'

/** One task with the fields a test does not vary filled in. */
function task(overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: 'daily',
    workspacePath: '/tmp/workspace',
    time: '09:30:00',
    timeZone: 'UTC',
    prompt: 'do the thing',
    permissionPreset: 'unattended',
    ...overrides,
  }
}

/** Epoch milliseconds for one RFC 3339 instant. */
function at(iso: string): number {
  return Date.parse(iso)
}

describe('resolveTimeZone', () => {
  it('canonicalizes UTC and an IANA name', () => {
    expect(resolveTimeZone('UTC')).toBe('UTC')
    expect(resolveTimeZone('Europe/Berlin')).toBe('Europe/Berlin')
  })

  it('defaults to the process zone when the task declares none', () => {
    expect(resolveTimeZone(undefined)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it.each([
    ['a bare word', 'Berlin'],
    ['a padded name', ' UTC'],
    ['an offset', '+02:00'],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(() => resolveTimeZone(value)).toThrow(SchedulerTimeError)
    expect(() => resolveTimeZone(value)).toThrow(/UTC or an IANA Area\/Location name/)
  })
})

describe('resolveDailySchedule', () => {
  it('reduces a task to its recurrence', () => {
    expect(resolveDailySchedule(task({ weekdays: [5, 1, 1] }))).toEqual({
      taskId: 'daily',
      hour: 9,
      minute: 30,
      second: 0,
      weekdays: [1, 5],
      timeZone: 'UTC',
    })
  })

  it('leaves weekdays undefined when the task declares none', () => {
    expect(resolveDailySchedule(task()).weekdays).toBeUndefined()
  })

  it.each([
    ['a single-digit hour', '9:30:00'],
    ['a missing seconds field', '09:30'],
    ['an out-of-range hour', '24:00:00'],
    ['an out-of-range minute', '09:60:00'],
    ['a trailing space', '09:30:00 '],
    ['an empty string', ''],
  ])('refuses %s', (_label, time) => {
    expect(() => resolveDailySchedule(task({ time }))).toThrow(/time must be HH:MM:SS in 24-hour form/)
  })

  it('refuses an empty weekdays list', () => {
    expect(() => resolveDailySchedule(task({ weekdays: [] }))).toThrow(/empty weekdays list/)
  })

  it.each([[-1], [7], [1.5], [Number.NaN]])('refuses weekday %s', (day) => {
    expect(() => resolveDailySchedule(task({ weekdays: [day] }))).toThrow(/weekday must be 0 \(Sunday\) through 6 \(Saturday\)/)
  })
})

describe('nextOccurrence', () => {
  it('resolves the same day when the time is still ahead', () => {
    const schedule = resolveDailySchedule(task({ time: '09:30:00' }))
    expect(nextOccurrence(schedule, at('2026-09-15T08:00:00Z'))).toBe(at('2026-09-15T09:30:00Z'))
  })

  it('advances to the next day once the time has passed', () => {
    const schedule = resolveDailySchedule(task({ time: '09:30:00' }))
    expect(nextOccurrence(schedule, at('2026-09-15T10:00:00Z'))).toBe(at('2026-09-16T09:30:00Z'))
  })

  it('is strictly after now, so a process restart never replays a due time', () => {
    const schedule = resolveDailySchedule(task({ time: '09:30:00' }))
    const exact = at('2026-09-15T09:30:00Z')
    expect(nextOccurrence(schedule, exact)).toBe(at('2026-09-16T09:30:00Z'))
  })

  it('interprets the local time in the configured zone', () => {
    // 09:30 in Berlin on this date is 07:30 UTC (CEST, +02:00).
    const schedule = resolveDailySchedule(task({ time: '09:30:00', timeZone: 'Europe/Berlin' }))
    expect(nextOccurrence(schedule, at('2026-09-15T00:00:00Z'))).toBe(at('2026-09-15T07:30:00Z'))
  })

  it('follows a daylight-saving offset change between occurrences', () => {
    const schedule = resolveDailySchedule(task({ time: '09:30:00', timeZone: 'Europe/Berlin' }))
    // Before the autumn change the offset is +02:00, after it +01:00.
    expect(nextOccurrence(schedule, at('2026-10-20T00:00:00Z'))).toBe(at('2026-10-20T07:30:00Z'))
    expect(nextOccurrence(schedule, at('2026-11-02T00:00:00Z'))).toBe(at('2026-11-02T08:30:00Z'))
  })

  it('picks the first instant of an overlap', () => {
    // Berlin repeats 02:30 on 2026-10-25; the earlier (+02:00) instant wins.
    const schedule = resolveDailySchedule(task({ time: '02:30:00', timeZone: 'Europe/Berlin' }))
    expect(nextOccurrence(schedule, at('2026-10-24T12:00:00Z'))).toBe(at('2026-10-25T00:30:00Z'))
  })

  it('skips a local time removed by a spring-forward gap', () => {
    // Berlin has no 02:30 on 2026-03-29, so the next occurrence is the following day.
    const schedule = resolveDailySchedule(task({ time: '02:30:00', timeZone: 'Europe/Berlin' }))
    expect(nextOccurrence(schedule, at('2026-03-28T12:00:00Z'))).toBe(at('2026-03-30T00:30:00Z'))
  })

  it('selects only the configured weekdays', () => {
    // 2026-09-15 is a Tuesday; the task runs Mondays only.
    const schedule = resolveDailySchedule(task({ time: '09:30:00', weekdays: [1] }))
    expect(nextOccurrence(schedule, at('2026-09-15T10:00:00Z'))).toBe(at('2026-09-21T09:30:00Z'))
  })

  it('refuses a non-integral clock reading', () => {
    const schedule = resolveDailySchedule(task())
    expect(() => nextOccurrence(schedule, 1.5)).toThrow(/non-integral clock reading/)
    expect(() => nextOccurrence(schedule, Number.NaN)).toThrow(/non-integral clock reading/)
  })

  it('resolves a negative-offset zone across its own offset change', () => {
    // New York is UTC-04:00 in September and UTC-05:00 after the autumn change.
    const schedule = resolveDailySchedule(task({ time: '09:30:00', timeZone: 'America/New_York' }))
    expect(nextOccurrence(schedule, at('2026-09-15T00:00:00Z'))).toBe(at('2026-09-15T13:30:00Z'))
    expect(nextOccurrence(schedule, at('2026-11-10T00:00:00Z'))).toBe(at('2026-11-10T14:30:00Z'))
  })

  it('refuses a clock reading whose search window leaves the calendar', () => {
    const schedule = resolveDailySchedule(task())
    // The maximum representable instant walks off the end of `Date`, so no
    // occurrence exists inside the bounded window.
    expect(() => nextOccurrence(schedule, 8_640_000_000_000_000)).toThrow(/has no occurrence within 14 days/)
  })
})
