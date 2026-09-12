/** The Nord palette tuner: ten base colors and a background image, live preview, explicit save. */

import { useRef } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ROLE_LABEL } from './locales.ts'
import type { NordThemeActions, NordThemeTabState } from './nord-theme-controller.ts'
import styles from './NordThemeTab.module.css'

/** The face this tuner's slot registration injects. */
export interface NordThemeTabFace extends NordThemeActions {
  hooks: {
    /** Tuner snapshot, bound by the renderer as `useNordTheme`. */
    nordTheme: SnapshotStore<NordThemeTabState>
  }
}

/** Props the renderer binds for the tuner. */
export type NordThemeTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'nordTheme'>
  & InjectFace<NordThemeTabFace>

/**
 * Render the palette tuner.
 * @param props - locale copy, the tuner snapshot, and its form actions.
 * @returns the tuner, or nothing while the Host does not serve the namespace.
 */
export function NordThemeTab(props: NordThemeTabProps) {
  const { t } = props
  const state = props.useNordTheme(snapshot => snapshot)
  // The picker is the file dialog itself, opened by the localized button; a
  // native input's own chrome carries text this plugin does not own.
  const picker = useRef<HTMLInputElement | null>(null)
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const wallpaperStatus = state.uploading
    ? t('wallpaperUploading')
    : state.wallpaperFailed
      // The Host's own message follows the localized prefix: it names the cause
      // (an unsupported media type, an oversized image, an unmounted namespace)
      // that a bare failure could not.
      ? `${t('wallpaperFailed')}${state.wallpaperError === '' ? '' : ` (${state.wallpaperError})`}`
      : state.wallpaper ? '' : t('wallpaperNone')
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.description}>{t('description')}</p>
      </header>
      <ul className={styles.roles}>
        {state.roles.map(role => (
          <li className={styles.row} key={role.role}>
            <span className={styles.label}>
              {t(ROLE_LABEL[role.role])}
              {role.overridden ? <span className={styles.badge}>{t('overridden')}</span> : null}
            </span>
            <input
              className={styles.swatch}
              type="color"
              value={role.light}
              disabled={disabled}
              aria-label={`${t(ROLE_LABEL[role.role])} ${t('light')}`}
              onChange={(event) => { props.edit(role.role, 'light', event.target.value) }}
            />
            <input
              className={styles.swatch}
              type="color"
              value={role.dark}
              disabled={disabled}
              aria-label={`${t(ROLE_LABEL[role.role])} ${t('dark')}`}
              onChange={(event) => { props.edit(role.role, 'dark', event.target.value) }}
            />
            <button
              className={styles.reset}
              type="button"
              disabled={disabled}
              onClick={() => { props.resetRole(role.role) }}
            >
              {t('reset')}
            </button>
          </li>
        ))}
      </ul>
      <section className={styles.wallpaper}>
        <h3 className={styles.sectionTitle}>{t('wallpaperTitle')}</h3>
        <p className={styles.description}>{t('wallpaperDescription')}</p>
        <div className={styles.wallpaperRow}>
          <input
            ref={picker}
            className={styles.picker}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden
            disabled={disabled || state.uploading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Clearing the value lets the same file fire `change` again.
              event.target.value = ''
              if (file !== undefined) props.chooseWallpaper(file)
            }}
          />
          <button
            className={styles.action}
            type="button"
            disabled={disabled || state.uploading}
            onClick={() => { picker.current?.click() }}
          >
            {t('chooseImage')}
          </button>
          <button
            className={styles.action}
            type="button"
            disabled={disabled || !state.wallpaper}
            onClick={props.clearWallpaper}
          >
            {t('removeImage')}
          </button>
          <span className={styles.status}>{wallpaperStatus}</span>
        </div>
        <label className={styles.sliderRow}>
          <span className={styles.label}>{t('wallpaperOpacity')}</span>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            value={state.wallpaperOpacity}
            disabled={disabled || !state.wallpaper}
            onChange={(event) => { props.setWallpaperOpacity(Number(event.target.value)) }}
          />
          <span className={styles.readout}>
            {state.wallpaperOpacity}
            {t('opacityUnit')}
          </span>
        </label>
      </section>
      <footer className={styles.footer}>
        <span className={styles.status}>
          {state.saving ? t('saving') : state.failed ? t('saveFailed') : state.dirty ? t('unsaved') : ''}
        </span>
        <button className={styles.action} type="button" disabled={disabled} onClick={props.resetAll}>
          {t('resetAll')}
        </button>
        <button
          className={styles.action}
          type="button"
          disabled={!state.dirty || state.saving}
          onClick={props.discard}
        >
          {t('discard')}
        </button>
        <button
          className={styles.primary}
          type="button"
          disabled={!state.dirty || disabled}
          onClick={props.save}
        >
          {t('save')}
        </button>
      </footer>
      {state.writable ? null : <p className={styles.readOnly}>{t('readOnly')}</p>}
    </section>
  )
}
