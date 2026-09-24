/**
 * The Nord palette as ten tunable roles per color scheme, and the alias-token
 * map derived from them.
 *
 * Both plugin halves import this module: the Host half builds its settings
 * schema from {@link DEFAULT_PALETTE}, the browser half turns the resolved
 * values into the override layer. Every derived token names a role, so retuning
 * one role moves every surface that reads it.
 */

/** One role's value in each color scheme. */
export interface ColorRole {
  /** Value applied while the light palette is active. */
  readonly light: string
  /** Value applied while the dark palette is active. */
  readonly dark: string
}

/** The roles a user may retune. */
export const ROLES = [
  'background', 'surface', 'surfaceRaised', 'surfaceDeep', 'text',
  'accent', 'accentAlt', 'danger', 'success', 'warning',
] as const

/** One tunable role. */
export type Role = typeof ROLES[number]

/** Every role's value per scheme. */
export type Palette = Readonly<Record<Role, ColorRole>>

/** The North palette, which is what an unconfigured plugin applies. */
export const DEFAULT_PALETTE: Palette = Object.freeze({
  background: Object.freeze({ light: '#ECEFF4', dark: '#2E3440' }),
  surface: Object.freeze({ light: '#FFFFFF', dark: '#3B4252' }),
  surfaceRaised: Object.freeze({ light: '#E5E9F0', dark: '#434C5E' }),
  surfaceDeep: Object.freeze({ light: '#D8DEE9', dark: '#4C566A' }),
  text: Object.freeze({ light: '#2E3440', dark: '#ECEFF4' }),
  accent: Object.freeze({ light: '#5E81AC', dark: '#88C0D0' }),
  accentAlt: Object.freeze({ light: '#81A1C1', dark: '#8FBCBB' }),
  danger: Object.freeze({ light: '#B04A54', dark: '#CF7B84' }),
  success: Object.freeze({ light: '#54703F', dark: '#A3BE8C' }),
  warning: Object.freeze({ light: '#8A6410', dark: '#EBCB8B' }),
})

/**
 * The channel triple of one role value, for the translucent variants.
 * @param hex - a six-digit `#rrggbb` value.
 * @returns the `r, g, b` string `rgba()` takes.
 */
function channels(hex: string): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `${String(red)}, ${String(green)}, ${String(blue)}`
}

/**
 * A translucent form of a role value, for the ramps the scheme derives rather
 * than names.
 * @param hex - the role value to shade.
 * @param alpha - opacity from 0 to 1.
 * @returns the `rgba()` value.
 */
function shade(hex: string, alpha: number): string {
  return `rgba(${channels(hex)}, ${String(alpha)})`
}

/**
 * Build the complete override layer for one palette.
 *
 * Every `--dsw-alias-*` and `--dsw-specific-*` token the ui-theme sheets
 * declare is present, so no surface keeps a base-palette value that would clash
 * with the scheme. Values the palette does not name — the overlay scrims and
 * the media tool-bar chips — stay literal in both schemes.
 * @param palette - the resolved role values.
 * @returns token name to per-scheme value.
 */
export function buildTokens(palette: Palette): Record<string, ColorRole> {
  const { background, surface, surfaceRaised, surfaceDeep, text, accent, accentAlt, danger, success, warning } = palette
  const self = (role: ColorRole): ColorRole => ({ light: role.light, dark: role.dark })
  const onText = (alpha: number): ColorRole => ({ light: shade(text.light, alpha), dark: shade(text.dark, alpha) })
  const onAccent = (alpha: number): ColorRole => ({ light: shade(accent.light, alpha), dark: shade(accent.dark, alpha) })
  const onState = (role: ColorRole): ColorRole => ({ light: shade(role.light, 0.85), dark: shade(role.dark, 0.72) })
  const tone = (role: ColorRole, alpha: number): ColorRole => ({ light: shade(role.light, alpha), dark: shade(role.dark, alpha) })

  return {
    // Ground and surfaces.
    '--dsw-alias-bg-base': self(background),
    // The document preview stays a polar-night backdrop in both schemes, one
    // step deeper in the dark one, because the surface is dark either way.
    '--dsw-alias-bg-document-preview': { light: surfaceDeep.dark, dark: background.dark },
    '--dsw-alias-bg-layer-1': self(surface),
    '--dsw-alias-bg-layer-2': { light: surface.light, dark: surfaceRaised.dark },
    '--dsw-alias-bg-layer-3': { light: surface.light, dark: surfaceDeep.dark },
    '--dsw-alias-bg-module-platform': { light: surfaceRaised.light, dark: surface.dark },
    '--dsw-alias-bg-multi-select': self(surfaceRaised),
    '--dsw-alias-bg-overlay': { light: surface.light, dark: surfaceRaised.dark },
    '--dsw-alias-bg-skeleton': onText(0.06),
    '--dsw-alias-bg-mask-1': { light: 'rgba(0, 0, 0, 0.24)', dark: 'rgba(0, 0, 0, 0.5)' },
    '--dsw-alias-bg-mask-2': { light: 'rgba(0, 0, 0, 0.12)', dark: 'rgba(0, 0, 0, 0.2)' },
    '--dsw-alias-bg-mask-3': { light: 'rgba(0, 0, 0, 0.48)', dark: 'rgba(0, 0, 0, 0.48)' },
    '--dsw-alias-bg-mask-photo': { light: 'rgba(0, 0, 0, 0.88)', dark: 'rgba(0, 0, 0, 0.88)' },
    '--dsw-alias-bg-mask-drop': { light: 'rgba(255, 255, 255, 0.7)', dark: shade(background.dark, 0.7) },

    // Hairlines and separators.
    '--dsw-alias-border-inverted': { light: shade(text.light, 0), dark: shade(text.dark, 0.06) },
    '--dsw-alias-border-inverted2': { light: shade(text.light, 0), dark: shade(text.dark, 0.08) },
    '--dsw-alias-border-l1': onText(0.04),
    '--dsw-alias-border-l2': onText(0.1),
    '--dsw-alias-border-l2-darkmode-thin': { light: shade(text.light, 0.1), dark: shade(text.dark, 0.06) },
    '--dsw-alias-border-l3': onText(0.12),
    '--dsw-alias-border-l4': onText(0.16),

    // Brand and controls.
    '--dsw-alias-brand-primary': self(accent),
    '--dsw-alias-brand-primary-invert': self(background),
    '--dsw-alias-brand-primary-new-colorprimary-new-color': self(accent),
    '--dsw-alias-brand-text': self(accent),
    '--dsw-alias-button-contrast-fill': self(text),
    '--dsw-alias-button-elevated-fill': { light: surface.light, dark: surfaceRaised.dark },
    '--dsw-alias-button-floating-fill': self(surface),
    '--dsw-alias-button-floating-hover': self(surfaceRaised),
    '--dsw-alias-button-ghost-active-border': self(accentAlt),
    '--dsw-alias-button-ghost-active-fill': { light: shade(accent.light, 0.12), dark: surfaceRaised.dark },
    '--dsw-alias-button-ghost-active-hover': { light: shade(accent.light, 0.18), dark: surfaceDeep.dark },
    '--dsw-alias-button-info-fill': { light: accent.light, dark: accentAlt.dark },
    '--dsw-alias-button-info-hover': self(accentAlt),
    '--dsw-alias-button-primary-dimmed': { light: shade(accent.light, 0.16), dark: surfaceDeep.dark },
    '--dsw-alias-button-primary-fill': self(accent),
    '--dsw-alias-button-primary-hover': self(accentAlt),
    '--dsw-alias-button-tool-bar-fill': { light: 'rgba(76, 86, 106, 0.5)', dark: 'rgba(76, 86, 106, 0.5)' },
    '--dsw-alias-button-tool-bar-fill-invisible': { light: 'rgba(31, 31, 31, 0.36)', dark: 'rgba(31, 31, 31, 0.36)' },
    '--dsw-alias-button-tool-bar-hover': { light: 'rgba(76, 86, 106, 0.6)', dark: 'rgba(76, 86, 106, 0.6)' },

    // Pointer states.
    '--dsw-alias-interactive-bg-active': onText(0.1),
    '--dsw-alias-interactive-bg-hover': onText(0.06),
    '--dsw-alias-interactive-bg-hover-accent': { light: shade(accent.light, 0.14), dark: shade(accent.dark, 0.24) },
    '--dsw-alias-interactive-bg-hover-danger': { light: shade(danger.light, 0.1), dark: shade(danger.dark, 0.15) },
    '--dsw-alias-interactive-bg-hover-solid': self(surfaceRaised),

    // Text ramp.
    '--dsw-alias-label-caption': onText(0.45),
    '--dsw-alias-label-dimmed': onText(0.28),
    '--dsw-alias-label-document-preview': { light: background.light, dark: text.dark },
    '--dsw-alias-label-primary': self(text),
    '--dsw-alias-label-primary-bluish': self(accent),
    '--dsw-alias-label-primary-dimmed': { light: shade(text.light, 0.88), dark: shade(text.dark, 0.85) },
    '--dsw-alias-label-primary-foreground': { light: surface.light, dark: background.dark },
    '--dsw-alias-label-primary-inverted': { light: surface.light, dark: background.dark },
    '--dsw-alias-label-secondary': onText(0.78),
    '--dsw-alias-label-tertiary': onText(0.6),
    '--dsw-alias-link': self(accent),

    // Markdown surfaces.
    '--dsw-alias-markdown-citation': self(surfaceRaised),
    '--dsw-alias-markdown-code-block': { light: surfaceRaised.light, dark: surface.dark },
    '--dsw-alias-markdown-code-block-banner': { light: surfaceDeep.light, dark: surfaceRaised.dark },
    '--dsw-alias-markdown-code-segment-selected': { light: surface.light, dark: surfaceRaised.dark },
    '--dsw-alias-markdown-code-segment-unselected': { light: surfaceRaised.light, dark: surface.dark },
    '--dsw-alias-markdown-inline-code': onText(0.06),
    '--dsw-alias-markdown-placeholder': self(surfaceDeep),
    '--dsw-alias-markdown-tag': self(surfaceRaised),

    // Diff surfaces: tints of the success and danger roles, never the roles
    // themselves, so a diff line stays legible under the scheme's own text. The
    // line background is the stronger tint, the gutter the weaker one, and both
    // carry more alpha in the dark scheme where a tint reads fainter.
    '--dsw-alias-code-diff-added': { light: shade(success.light, 0.08), dark: shade(success.dark, 0.12) },
    '--dsw-alias-code-diff-deleted': { light: shade(danger.light, 0.08), dark: shade(danger.dark, 0.12) },
    '--dsw-alias-file-diff-added-bg': { light: shade(success.light, 0.12), dark: shade(success.dark, 0.16) },
    '--dsw-alias-file-diff-added-gutter': { light: shade(success.light, 0.08), dark: shade(success.dark, 0.12) },
    '--dsw-alias-file-diff-added-marker': self(success),
    '--dsw-alias-file-diff-deleted-bg': { light: shade(danger.light, 0.12), dark: shade(danger.dark, 0.16) },
    '--dsw-alias-file-diff-deleted-gutter': { light: shade(danger.light, 0.08), dark: shade(danger.dark, 0.12) },
    '--dsw-alias-file-diff-deleted-marker': self(danger),

    // Scrollbars.
    '--dsw-alias-scrollbar-bg-l1': onText(0.14),
    '--dsw-alias-scrollbar-bg-l2': onText(0.14),
    '--dsw-alias-scrollbar-hover-l1': onText(0.28),
    '--dsw-alias-scrollbar-hover-l2': onText(0.28),

    // States.
    '--dsw-alias-state-business-primary': { light: accent.light, dark: accentAlt.dark },
    '--dsw-alias-state-business-tertiary': tone(accent, 0.16),
    '--dsw-alias-state-error-primary': self(danger),
    '--dsw-alias-state-error-secondary': onState(danger),
    // The deep surface tone, which is what the neutral ramp the alias sheet
    // resolves for this token lands on in each scheme.
    '--dsw-alias-state-idle-primary': self(surfaceDeep),
    '--dsw-alias-state-success-primary': self(success),
    '--dsw-alias-state-success-secondary': onState(success),
    '--dsw-alias-state-success-tertiary': tone(success, 0.18),
    '--dsw-alias-state-warn-label': self(warning),
    '--dsw-alias-state-warn-primary': self(warning),
    '--dsw-alias-state-warn-secondary': onState(warning),
    '--dsw-alias-state-warn-tertiary': tone(warning, 0.18),

    // Elevated notifications.
    '--dsw-alias-toast-bg': { light: text.light, dark: surfaceRaised.dark },
    '--dsw-alias-tooltip-bg': { light: text.light, dark: surfaceRaised.dark },

    // Feature-owned seats.
    '--dsw-specific-bubble': { light: surfaceRaised.light, dark: surfaceRaised.dark },
    '--dsw-specific-bubble-highlight': self(surfaceDeep),
    '--dsw-specific-input-major': self(surface),
    '--dsw-specific-login-input': { light: surfaceRaised.light, dark: background.dark },
    '--dsw-specific-menu': { light: surface.light, dark: surfaceDeep.dark },
    '--dsw-specific-selector': self(surfaceRaised),
    '--dsw-specific-sidebar-fill': { light: surfaceRaised.light, dark: background.dark },
    '--dsw-specific-sidebar-nav-item-active': { light: shade(accent.light, 0.12), dark: surfaceRaised.dark },
    '--dsw-specific-sidebar-nav-item-active-accent': onAccent(0.2),
    '--dsw-specific-sidebar-nav-item-hover': { light: shade(accent.light, 0.08), dark: surface.dark },
    '--dsw-specific-tip': self(surfaceRaised),
  }
}
