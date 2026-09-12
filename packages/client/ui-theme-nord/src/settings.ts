/**
 * The settings namespace this plugin owns: the tunable palette roles plus the
 * deployment cap on stored wallpaper size.
 *
 * The schema lives outside the plugin entry because the Host service is a
 * class plugin: Cordis reads its schema from `static Config`, and the same
 * schema is what `installSection` serves to the browser half.
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_PALETTE } from './palette.ts'
import { DEFAULT_WALLPAPER_OPACITY, type NordSection } from './section.ts'

/** Settings namespace this plugin owns; the browser half binds the same name. */
export const NORD_SETTINGS_NAMESPACE = 'theme-nord'

/**
 * One role's schema, defaulting to the North value.
 * @param role - the default value in each scheme.
 * @returns the role's settings schema.
 */
function roleSchema(role: { readonly light: string; readonly dark: string }) {
  return z.object({
    light: z.string().default(role.light),
    dark: z.string().default(role.dark),
  })
}

/** The settings schema, whose defaults come from the palette defaults. */
export const Config: z<NordSection> = z.object({
  background: roleSchema(DEFAULT_PALETTE.background),
  surface: roleSchema(DEFAULT_PALETTE.surface),
  surfaceRaised: roleSchema(DEFAULT_PALETTE.surfaceRaised),
  surfaceDeep: roleSchema(DEFAULT_PALETTE.surfaceDeep),
  text: roleSchema(DEFAULT_PALETTE.text),
  accent: roleSchema(DEFAULT_PALETTE.accent),
  accentAlt: roleSchema(DEFAULT_PALETTE.accentAlt),
  danger: roleSchema(DEFAULT_PALETTE.danger),
  success: roleSchema(DEFAULT_PALETTE.success),
  warning: roleSchema(DEFAULT_PALETTE.warning),
  wallpaper: z.string().default(''),
  wallpaperMediaType: z.string().default(''),
  wallpaperOpacity: z.number().min(0).max(100).default(DEFAULT_WALLPAPER_OPACITY),
})
