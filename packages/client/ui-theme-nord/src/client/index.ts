/**
 * Browser half of the Nord theme plugin.
 *
 * It owns three things: the override layer stacked on the theme service, the
 * wallpaper sheets painting the selected background image, and the tuner in
 * Settings → Plugins that edits both. The layer is rebuilt on every edit, so
 * the tuner previews immediately; the settings document is written only when
 * the user saves.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.settingsScope and the settings SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the registry behind ctx.slots.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the theme service's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { NordSection } from '../section.ts'
import { en, zh } from './locales.ts'
import { NordThemeController } from './nord-theme-controller.ts'
import { NordThemeTab } from './NordThemeTab.tsx'
import wallpaperStyle from './wallpaper.css?inline'
import { createWallpaperPort, type WallpaperNamespace } from './wallpaper.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'nordTheme'

/**
 * Settings namespace the Host half registers. Spelled here rather than
 * imported: pulling the Host half in would inline its schema library into the
 * browser artifact.
 */
const SETTINGS_NAMESPACE = 'theme-nord'

/** Plugin name, matching the package the loader mounts. */
export const name = '@deepseek-ai/dsh-client-ui-theme-nord'

/** Required services (cordis fiber inject). */
export const inject = ['theme', 'slots', 'locale', 'remote', 'settingsScope']

/**
 * Stack the palette layer, paint the wallpaper sheets, and contribute the tuner tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-theme-nord: tuner dictionaries')

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = name
    tag.dataset.pluginCss = `${name}/wallpaper.css`
    tag.textContent = wallpaperStyle
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'ui-theme-nord: wallpaper stylesheet')

  const controller = new NordThemeController(
    ctx.settingsScope.bind<NordSection>({ namespace: SETTINGS_NAMESPACE }),
    ctx.theme,
    // Read through `ctx.get`, not `ctx.remote.themeWallpaper`: the assembly
    // installs the namespace under the `remote.<namespace>` service key, and a
    // fiber may only read that key when it injects it. Reading it on demand
    // keeps the palette tuner active whether or not the namespace is mounted,
    // and the port reports the absence when an image is picked.
    createWallpaperPort(() => ctx.get('remote.themeWallpaper') as WallpaperNamespace | undefined),
  )
  ctx.effect(() => () => { controller.dispose() }, 'ui-theme-nord: override layer')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'nord-theme',
    order: 20,
    label: () => t('title'),
    locale: NS,
    inject: () => controller.inject(),
  }, NordThemeTab))
}
