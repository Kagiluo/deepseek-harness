/**
 * The Scheduled tasks settings page.
 *
 * Edits a local draft and submits the whole task list as one atomic settings
 * mutation. A draft rather than write-through, because the settings wire
 * replaces an array wholesale: a per-keystroke write would publish half-typed
 * tasks, and one save keeps the fence meaningful.
 */

import { useState } from 'react'
import { Button, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SchedulerLocaleKey } from './locales.ts'
import type { SchedulerPatch, SchedulerTasksState } from './tasks-store.ts'
import css from './SchedulerSection.module.css'

/** Weekday indices in display order, Sunday first. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

/** Actions the page calls; supplied by the apply closure. */
export interface SchedulerSectionInjected {
  /** Live store state, bound by the renderer as `useSchedulerTasks`. */
  hooks: {
    schedulerTasks: SchedulerTasksSource
  }
  /** Add one blank task to the draft. */
  add: () => void
  /** Remove the task at one index. */
  remove: (index: number) => void
  /** Patch the task at one index. */
  patch: (index: number, next: SchedulerPatch) => void
  /** Persist the whole draft. */
  save: () => Promise<void>
  /** Restore the draft to the last saved list. */
  discard: () => void
}

/** Bare observable the renderer binds to `useSchedulerTasks`. */
export interface SchedulerTasksSource {
  /** Read the identity-stable current snapshot. */
  getSnapshot(): SchedulerTasksState
  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** Full component props: section owner share, locale seat, injected actions, live state. */
export type SchedulerSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.scheduler'>
  & InjectFace<SchedulerSectionInjected>

/** Parse `HH:MM:SS` into the three parts the time input renders. */
function timeParts(value: string): { hour: string; minute: string; second: string } {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value)
  return { hour: match?.[1] ?? '', minute: match?.[2] ?? '', second: match?.[3] ?? '' }
}

/** Join the time input's three parts back into a stored value. */
function joinTime(hour: string, minute: string, second: string): string {
  if (hour === '' || minute === '' || second === '') return ''
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
}

/**
 * Validate the draft the way the Host will, so a save never round-trips a
 * refusal the page could have shown immediately.
 * @param draft - the tasks the form currently holds.
 * @param t - the bound dictionary.
 * @returns the first failure message, or `undefined` when the draft is storable.
 */
function firstFailure(
  draft: SchedulerTasksState['draft'],
  t: (key: SchedulerLocaleKey) => string,
): string | undefined {
  const ids = new Set<string>()
  for (const task of draft) {
    if (task.id.trim() === '') return t('validation.emptyId')
    if (ids.has(task.id)) return t('validation.duplicateId')
    ids.add(task.id)
    if (task.workspacePath.trim() === '') return t('validation.workspace')
    if (!/^\d{2}:\d{2}:\d{2}$/.test(task.time)) return t('validation.time')
    if (task.weekdays !== undefined && task.weekdays.length === 0) return t('validation.weekdays')
    if (task.prompt.trim() === '') return t('validation.prompt')
    if (task.permissionPreset.trim() === '') return t('validation.permissionPreset')
  }
  return undefined
}

/**
 * Render the Scheduled tasks settings page.
 * @param props - composed slot props.
 * @returns the page element tree.
 */
export function SchedulerSection(props: SchedulerSectionProps): React.JSX.Element {
  const { t, useSchedulerTasks, add, remove, patch, save, discard } = props
  const state = useSchedulerTasks(snapshot => snapshot)
  const [confirming, setConfirming] = useState<number | undefined>(undefined)

  if (state.status === 'unavailable') {
    return <div className={css.page}><p className={css.notice}>{t('unavailable')}</p></div>
  }

  const blocked = firstFailure(state.draft, t)
  const disabled = !state.writable || state.saving

  return (
    <div className={css.page}>
      <p className={css.intro}>{t('intro')}</p>

      {state.status === 'ready' && state.draft.length === 0
        ? (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{t('empty')}</p>
            <p className={css.notice}>{t('emptyHint')}</p>
          </div>
        )
        : null}

      <ol className={css.list}>
        {state.draft.map((task, index) => {
          const time = timeParts(task.time)
          const missingWorkspace = task.workspacePath !== ''
            && !state.workspaces.some(option => option.path === task.workspacePath)
          return (
            <li className={css.task} key={index}>
              <div className={css.taskHeader}>
                <span className={css.taskHeading}>
                  {t('taskHeading').replace('{number}', String(index + 1))}
                </span>
                {task.enabled === false ? <Tag tone="neutral">{t('enabled')}</Tag> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setConfirming(index) }}
                  aria-label={`${t('remove')} ${String(index + 1)}`}
                >
                  {t('remove')}
                </Button>
              </div>

              <label className={css.field}>
                <span className={css.label}>{t('id')}</span>
                <Input
                  value={task.id}
                  disabled={disabled}
                  aria-label={`${t('id')} ${String(index + 1)}`}
                  onChange={(event) => { patch(index, { id: event.target.value }) }}
                />
                <span className={css.hint}>{t('idHint')}</span>
              </label>

              <label className={css.field}>
                <span className={css.label}>{t('workspace')}</span>
                <select
                  className={css.select}
                  value={task.workspacePath}
                  disabled={disabled}
                  aria-label={`${t('workspace')} ${String(index + 1)}`}
                  onChange={(event) => { patch(index, { workspacePath: event.target.value }) }}
                >
                  <option value="">{t('chooseWorkspace')}</option>
                  {missingWorkspace ? <option value={task.workspacePath}>{task.workspacePath}</option> : null}
                  {state.workspaces.map(option => (
                    <option value={option.path} key={option.path}>{option.name}</option>
                  ))}
                </select>
                <span className={css.hint}>{missingWorkspace ? t('workspaceMissing') : t('workspaceHint')}</span>
              </label>

              <div className={css.row}>
                <label className={css.field}>
                  <span className={css.label}>{t('time')}</span>
                  <span className={css.time}>
                    <input
                      className={css.timeInput}
                      type="number"
                      min={0}
                      max={23}
                      value={time.hour}
                      disabled={disabled}
                      aria-label={`${t('time')} ${String(index + 1)} ${t('time.hour')}`}
                      onChange={(event) => {
                        patch(index, { time: joinTime(event.target.value, time.minute, time.second) })
                      }}
                    />
                    <span className={css.colon}>:</span>
                    <input
                      className={css.timeInput}
                      type="number"
                      min={0}
                      max={59}
                      value={time.minute}
                      disabled={disabled}
                      aria-label={`${t('time')} ${String(index + 1)} ${t('time.minute')}`}
                      onChange={(event) => {
                        patch(index, { time: joinTime(time.hour, event.target.value, time.second) })
                      }}
                    />
                    <span className={css.colon}>:</span>
                    <input
                      className={css.timeInput}
                      type="number"
                      min={0}
                      max={59}
                      value={time.second}
                      disabled={disabled}
                      aria-label={`${t('time')} ${String(index + 1)} ${t('time.second')}`}
                      onChange={(event) => {
                        patch(index, { time: joinTime(time.hour, time.minute, event.target.value) })
                      }}
                    />
                  </span>
                  <span className={css.hint}>{t('timeHint')}</span>
                </label>

                <label className={css.field}>
                  <span className={css.label}>{t('timeZone')}</span>
                  <Input
                    value={task.timeZone ?? ''}
                    disabled={disabled}
                    aria-label={`${t('timeZone')} ${String(index + 1)}`}
                    onChange={(event) => {
                      const next = event.target.value
                      patch(index, { timeZone: next.trim() === '' ? undefined : next })
                    }}
                  />
                  <span className={css.hint}>{t('timeZoneHint')}</span>
                </label>
              </div>

              <div className={css.field}>
                <span className={css.label}>{t('weekdays')}</span>
                <div className={css.weekdays} role="group" aria-label={`${t('weekdays')} ${String(index + 1)}`}>
                  {WEEKDAYS.map((day) => {
                    const selected = task.weekdays === undefined || task.weekdays.includes(day)
                    return (
                      <label className={css.weekday} key={day}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => {
                            const current = task.weekdays ?? [...WEEKDAYS]
                            const next = current.includes(day)
                              ? current.filter(value => value !== day)
                              : [...current, day].sort((left, right) => left - right)
                            patch(index, {
                              // Every day is the stored default, so a full
                              // selection clears the key instead of restating it.
                              weekdays: next.length === WEEKDAYS.length ? undefined : next,
                            })
                          }}
                        />
                        <span>{t(`weekday.${String(day)}` as SchedulerLocaleKey)}</span>
                      </label>
                    )
                  })}
                </div>
                <span className={css.hint}>{t('weekdaysHint')}</span>
              </div>

              <label className={css.field}>
                <span className={css.label}>{t('prompt')}</span>
                <textarea
                  className={css.textarea}
                  value={task.prompt}
                  rows={3}
                  disabled={disabled}
                  aria-label={`${t('prompt')} ${String(index + 1)}`}
                  onChange={(event) => { patch(index, { prompt: event.target.value }) }}
                />
                <span className={css.hint}>{t('promptHint')}</span>
              </label>

              <div className={css.row}>
                <label className={css.field}>
                  <span className={css.label}>{t('permissionPreset')}</span>
                  <select
                    className={css.select}
                    value={task.permissionPreset}
                    disabled={disabled}
                    aria-label={`${t('permissionPreset')} ${String(index + 1)}`}
                    onChange={(event) => { patch(index, { permissionPreset: event.target.value }) }}
                  >
                    <option value="">{t('permissionPresetUnattended')}</option>
                    {state.permissionPresets.map(option => (
                      <option value={option.id} key={option.id}>{option.name}</option>
                    ))}
                  </select>
                  <span className={css.hint}>{t('permissionPresetHint')}</span>
                </label>

                <label className={css.field}>
                  <span className={css.label}>{t('agentPreset')}</span>
                  <select
                    className={css.select}
                    value={task.agentPreset ?? ''}
                    disabled={disabled}
                    aria-label={`${t('agentPreset')} ${String(index + 1)}`}
                    onChange={(event) => {
                      const next = event.target.value
                      patch(index, { agentPreset: next === '' ? undefined : next })
                    }}
                  >
                    <option value="">{t('agentPresetNone')}</option>
                    {state.presets.map(preset => (
                      <option value={preset.id} key={preset.id}>{preset.name}</option>
                    ))}
                  </select>
                  <span className={css.hint}>{t('agentPresetHint')}</span>
                </label>
              </div>

              <label className={css.field}>
                <span className={css.checkbox}>
                  <input
                    type="checkbox"
                    checked={task.enabled !== false}
                    disabled={disabled}
                    aria-label={`${t('enabled')} ${String(index + 1)}`}
                    onChange={(event) => { patch(index, { enabled: event.target.checked }) }}
                  />
                  <span>{t('enabled')}</span>
                </span>
                <span className={css.hint}>{t('enabledHint')}</span>
              </label>
            </li>
          )
        })}
      </ol>

      <div className={css.footer}>
        <Button variant="outline" size="sm" disabled={disabled} onClick={add}>{t('add')}</Button>
        {blocked === undefined ? null : <span className={css.blocked} role="alert">{blocked}</span>}
        {state.error === undefined
          ? null
          : <span className={css.blocked} role="alert">{t('saveFailed').replace('{message}', state.error)}</span>}
        <span className={css.spacer} />
        {state.dirty ? <span className={css.dirty}>{t('unsaved')}</span> : null}
        <Button variant="ghost" size="sm" disabled={!state.dirty || state.saving} onClick={discard}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled || !state.dirty || blocked !== undefined}
          onClick={() => { void save() }}
        >
          {state.saving ? t('saving') : t('save')}
        </Button>
      </div>

      {confirming === undefined
        ? null
        : (
          <Modal
            open
            onClose={() => { setConfirming(undefined) }}
            title={t('removeConfirmTitle')}
            closeLabel={t('close')}
          >
            <p className={css.notice}>{t('removeConfirmBody')}</p>
            <div className={css.footer}>
              <Button variant="ghost" size="sm" onClick={() => { setConfirming(undefined) }}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  remove(confirming)
                  setConfirming(undefined)
                }}
              >
                {t('confirmRemove')}
              </Button>
            </div>
          </Modal>
        )}
    </div>
  )
}
