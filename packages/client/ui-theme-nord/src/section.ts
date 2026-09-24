/**
 * The settings section this plugin owns, as both halves read it: the ten
 * palette roles plus the background-image fields.
 *
 * It lives apart from the plugin entry because the browser half needs the same
 * field types and must not reach the schema library that file imports.
 */

import type { Palette } from './palette.ts'

/** Background-image opacity a user who has not touched the slider starts from, as a percentage. */
export const DEFAULT_WALLPAPER_OPACITY = 30

/** The tunable section, as the settings document and the browser half see it. */
export type NordSection = Palette & {
  /** Content hash of the stored background image; empty when none is set. */
  wallpaper: string
  /** Media type recorded for {@link NordSection.wallpaper}, for the URL the tab builds. */
  wallpaperMediaType: string
  /** Background-image opacity, as a percentage. */
  wallpaperOpacity: number
}
