/**
 * Pure wall-clock resolution for one daily recurring task: a local `HH:MM:SS`
 * time plus an IANA zone resolves to the next epoch instant.
 *
 * Nothing here reads the process clock. Callers pass `now` and re-derive on
 * every wake, so the arithmetic stays testable and a wall-clock adjustment
 * cannot leave a stale target armed.
 * @module @deepseek-ai/dsh-scheduler/time
 */

import { canonicalClientTimeZone } from '@deepseek-ai/dsh-util-time'
import type { SchedulerTask } from './types.ts'

/** Strict `HH:MM:SS` local time of day. */
const TIME_OF_DAY = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d)$/

/** The `longOffset` zone-name spelling `Intl` emits for a numeric UTC offset. */
const OFFSET_NAME = /^GMT(?:(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?$/

/**
 * Days searched for the next selected occurrence. Seven covers every weekday
 * selection; the remainder absorbs consecutive non-existent local times at a
 * daylight-saving transition.
 */
const MAX_SEARCH_DAYS = 14

/** Local calendar fields plus the zone offset that produced them. */
interface LocalProjection {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly offset: number
}

/** Error from a task whose `time` or `timeZone` cannot denote a real instant. */
export class SchedulerTimeError extends Error {
  /** Stable machine-readable discriminator. */
  readonly code: 'invalid_time' | 'invalid_time_zone'

  /**
   * Construct a load-time schedule failure.
   * @param code - Which configured field is unusable.
   * @param message - Actionable diagnostic naming the task and the accepted form.
   * @param options - Optional contained implementation cause.
   */
  constructor(code: 'invalid_time' | 'invalid_time_zone', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SchedulerTimeError'
    this.code = code
  }
}

/** One validated daily recurrence, independent of any timer. */
export interface DailySchedule {
  /** Configured task id, carried into diagnostics. */
  readonly taskId: string
  /** Validated local hour, 0–23. */
  readonly hour: number
  /** Validated local minute, 0–59. */
  readonly minute: number
  /** Validated local second, 0–59. */
  readonly second: number
  /** Selected weekdays in ascending order, or `undefined` for every day. */
  readonly weekdays: readonly number[] | undefined
  /** Canonical IANA zone the three local fields are interpreted in. */
  readonly timeZone: string
}

/** Read one named capture as a number. */
function groupNumber(groups: Record<string, string | undefined>, key: string): number {
  return Number(groups[key])
}

/** Build an epoch from UTC calendar fields without the two-digit-year mapping. */
function utcEpoch(parts: Omit<LocalProjection, 'offset'>): number {
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0)
  return date.getTime()
}

/**
 * Format one epoch into exact local fields and the zone offset that produced them.
 *
 * The Schedule package's `localProjection` reads the same `longOffset` parts for
 * the same reason, and the two stay separate deliberately: each owns its own
 * calendar type and its own refusal, as `@deepseek-ai/dsh-util-time` states for
 * the zone boundary. Extracting the walk would make one package's error
 * vocabulary or field set depend on the other's.
 * @param formatter - zone formatter requested with `longOffset`.
 * @param epoch - the instant to project.
 * @returns the local calendar fields and the offset in milliseconds.
 * @throws {SchedulerTimeError} when the formatter exposes no usable offset.
 */
function localProjection(formatter: Intl.DateTimeFormat, epoch: number): LocalProjection {
  const values = Object.fromEntries(
    formatter.formatToParts(epoch).map(part => [part.type, part.value]),
  )
  /* v8 ignore next -- `longOffset` always contributes a `timeZoneName` part; the fallback keeps a
     formatter that omitted it a clean refusal instead of a crash, and which part Intl supplies is not
     a branch this package selects. */
  const offsetGroups = OFFSET_NAME.exec(values['timeZoneName'] ?? '')?.groups
  /* v8 ignore next 3 -- unreachable with the formatter this module builds. */
  if (offsetGroups === undefined) {
    throw new SchedulerTimeError('invalid_time_zone', 'timeZone did not expose a usable UTC offset.')
  }
  const direction = offsetGroups['sign'] === '-' ? -1 : 1
  /* v8 ignore next -- which spelling a zone resolves to is an Intl build property, not a branch this package selects. */
  const offset = offsetGroups['sign'] === undefined
    ? 0
    : direction * (groupNumber(offsetGroups, 'hour') * 3600 + groupNumber(offsetGroups, 'minute') * 60 + Number(offsetGroups['second'] ?? '0')) * 1000
  return {
    year: Number(values['year']),
    month: Number(values['month']),
    day: Number(values['day']),
    hour: Number(values['hour']),
    minute: Number(values['minute']),
    second: Number(values['second']),
    offset,
  }
}

/** Build the zone formatter daily resolution reads offsets through. */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
}

/**
 * Resolve one local wall-clock value in `timeZone`, choosing the first instant
 * of an overlap and reporting a gap as absent.
 *
 * A daylight-saving spring-forward removes the requested local time from that
 * date entirely, and no instant projects back to it. A local date beyond the
 * calendar `Date` can represent is reported the same way, as absent.
 * @param parts - Local calendar fields with a zero millisecond.
 * @param formatter - Zone formatter whose `longOffset` part supplies the offset.
 * @returns The earliest matching epoch instant, or `undefined` when the local time does not exist.
 */
function resolveLocalInstant(
  parts: Omit<LocalProjection, 'offset'>,
  formatter: Intl.DateTimeFormat,
): number | undefined {
  const localEpoch = utcEpoch(parts)
  if (!Number.isFinite(localEpoch)) return undefined
  const offsets = new Set<number>()
  for (const delta of [-172_800_000, -86_400_000, 0, 86_400_000, 172_800_000]) {
    offsets.add(localProjection(formatter, localEpoch + delta).offset)
  }
  const candidates: number[] = []
  for (const offset of offsets) {
    const candidate = localEpoch - offset
    const projected = localProjection(formatter, candidate)
    if (projected.year === parts.year
      && projected.month === parts.month
      && projected.day === parts.day
      && projected.hour === parts.hour
      && projected.minute === parts.minute
      && projected.second === parts.second) {
      candidates.push(candidate)
    }
  }
  return candidates.sort((left, right) => left - right)[0]
}

/**
 * Canonicalize one configured zone, defaulting to the process zone.
 * @param value - The task's `timeZone`, or `undefined` to use the process zone.
 * @returns The canonical IANA zone name.
 * @throws {SchedulerTimeError} when the name is not `UTC` or an IANA Area/Location identifier.
 */
export function resolveTimeZone(value: string | undefined): string {
  const candidate = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const canonical = canonicalClientTimeZone(candidate)
  if (canonical === undefined) {
    throw new SchedulerTimeError(
      'invalid_time_zone',
      `timeZone must be UTC or an IANA Area/Location name, got ${JSON.stringify(candidate)}.`,
    )
  }
  return canonical
}

/**
 * Validate one declared task and reduce it to its recurrence.
 * @param task - The declared task, as loaded from plugin config.
 * @returns The validated recurrence.
 * @throws {SchedulerTimeError} when `time`, `timeZone`, or `weekdays` cannot denote a real occurrence.
 */
export function resolveDailySchedule(task: SchedulerTask): DailySchedule {
  const groups = TIME_OF_DAY.exec(task.time)?.groups
  if (groups === undefined) {
    throw new SchedulerTimeError(
      'invalid_time',
      `task "${task.id}" time must be HH:MM:SS in 24-hour form, got ${JSON.stringify(task.time)}.`,
    )
  }
  const weekdays = task.weekdays
  if (weekdays !== undefined) {
    if (weekdays.length === 0) {
      throw new SchedulerTimeError('invalid_time', `task "${task.id}" declares an empty weekdays list, which never runs.`)
    }
    for (const day of weekdays) {
      if (!Number.isSafeInteger(day) || day < 0 || day > 6) {
        throw new SchedulerTimeError(
          'invalid_time',
          `task "${task.id}" weekday must be 0 (Sunday) through 6 (Saturday), got ${String(day)}.`,
        )
      }
    }
  }
  return {
    taskId: task.id,
    hour: groupNumber(groups, 'hour'),
    minute: groupNumber(groups, 'minute'),
    second: groupNumber(groups, 'second'),
    weekdays: weekdays === undefined ? undefined : [...new Set(weekdays)].sort((left, right) => left - right),
    timeZone: resolveTimeZone(task.timeZone),
  }
}

/**
 * Resolve the first occurrence strictly after `now`.
 *
 * Strictness is what implements the no-catch-up policy: a process that starts
 * after a due time arms the following occurrence instead of replaying the one
 * it slept through. A local time removed by a daylight-saving transition is
 * skipped, because no instant in that zone projects back to it.
 * @param schedule - A recurrence from {@link resolveDailySchedule}.
 * @param now - The wall-clock instant to search forward from, in epoch milliseconds.
 * @returns The epoch instant of the next occurrence.
 * @throws {SchedulerTimeError} when no occurrence exists inside the search window.
 */
export function nextOccurrence(schedule: DailySchedule, now: number): number {
  if (!Number.isSafeInteger(now)) {
    throw new SchedulerTimeError(
      'invalid_time',
      `task "${schedule.taskId}" cannot resolve against a non-integral clock reading.`,
    )
  }
  const formatter = zoneFormatter(schedule.timeZone)
  const anchor = utcEpoch({
    ...localProjection(formatter, now),
    hour: 0,
    minute: 0,
    second: 0,
  })
  for (let ahead = 0; ahead <= MAX_SEARCH_DAYS; ahead += 1) {
    const date = new Date(anchor + ahead * 86_400_000)
    if (Number.isNaN(date.getTime())) break
    if (schedule.weekdays !== undefined && !schedule.weekdays.includes(date.getUTCDay())) continue
    const resolved = resolveLocalInstant({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: schedule.hour,
      minute: schedule.minute,
      second: schedule.second,
    }, formatter)
    if (resolved !== undefined && resolved > now) return resolved
  }
  throw new SchedulerTimeError(
    'invalid_time',
    `task "${schedule.taskId}" has no occurrence within ${MAX_SEARCH_DAYS} days of ${new Date(now).toISOString()}.`,
  )
}
