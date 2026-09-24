/**
 * Host half of the Nord theme plugin.
 *
 * Two jobs: declare the live Config whose fields the browser half edits through
 * `configForms` under this Loader entry's id, and store the background image
 * its tab uploads. The image lives as a content-addressed file under the
 * Harness home and the settings document carries only its hash, so the settings
 * wire never moves image bytes.
 *
 * A Remote boundary carries JSON only, so the image arrives and leaves
 * base64-encoded.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// Type-only: brings the `settings` service declaration (ctx.settings).
import type {} from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PALETTE, type ColorRole } from './palette.ts'
import { DEFAULT_WALLPAPER_OPACITY } from './section.ts'
import type { StoredWallpaper, WallpaperId, WallpaperUpload } from './types.ts'

/** Cap on one stored image, so an upload cannot be turned into a disk-filling write. */
const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024

/** Directory under the Harness home holding stored background images. */
const WALLPAPER_DIRECTORY = 'theme-wallpaper'

/** Media types the store accepts. */
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

/**
 * One palette role's schema, defaulting to the North value.
 *
 * The role object is volatile as a whole, which makes both `light` and `dark`
 * editable through the plugin's settings form without remounting. It also
 * defaults as a whole, so a resolved role is always the value the palette
 * readers index rather than `undefined`.
 * @param role - the default value in each scheme.
 * @returns the role's settings schema.
 */
function roleSchema(role: ColorRole) {
  return z.object({
    light: z.string().default(role.light),
    dark: z.string().default(role.dark),
  }).default(role).volatile()
}

/** The Config the Loader parses; every user-editable field is a live reference. */
export interface Config {
  /** Base background role. */
  background: Volatile<ColorRole>
  /** Default card surface role. */
  surface: Volatile<ColorRole>
  /** Raised surface role. */
  surfaceRaised: Volatile<ColorRole>
  /** Deep surface role. */
  surfaceDeep: Volatile<ColorRole>
  /** Primary text role. */
  text: Volatile<ColorRole>
  /** Primary brand accent role. */
  accent: Volatile<ColorRole>
  /** Hover brand accent role. */
  accentAlt: Volatile<ColorRole>
  /** Error state role. */
  danger: Volatile<ColorRole>
  /** Success state role. */
  success: Volatile<ColorRole>
  /** Warning state role. */
  warning: Volatile<ColorRole>
  /** Content hash of the stored background image; empty when none is set. */
  wallpaper: Volatile<string>
  /** Media type recorded for {@link Config.wallpaper}, for the URL the tab builds. */
  wallpaperMediaType: Volatile<string>
  /** Background-image opacity, as a percentage. */
  wallpaperOpacity: Volatile<number>
}

/** The settings schema, whose defaults come from the palette defaults. */
export const Config = z.object({
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
  wallpaper: z.string().default('').volatile(),
  wallpaperMediaType: z.string().default('').volatile(),
  wallpaperOpacity: z.number().min(0).max(100).default(DEFAULT_WALLPAPER_OPACITY).volatile(),
})

/**
 * Host half: the live palette Config plus the background-image store.
 *
 * Storing by content hash makes re-picking the same image a no-op and keeps the
 * settings document free of image bytes. The tuner is this plugin's own page,
 * so the plugin opts out of the settings service's auto-generated form.
 */
export default class ThemeWallpaperGateway extends TypertRemoteService {
  /** Cordis reads the plugin's schema from this static. */
  static Config = Config

  private readonly directory: string

  /**
   * @param ctx - the host plugin context.
   * @param _config - the Loader's parsed Config; the browser half owns every value, so this half reads no field.
   */
  constructor(ctx: Context, _config: Config) {
    super(ctx, 'themeWallpaper')
    this.directory = join(resolveDshHome(), WALLPAPER_DIRECTORY)
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  }

  /**
   * Store one background image, addressed by its content hash.
   * @param upload - media type and base64 bytes as the browser sent them.
   * @returns the stored image's identity and decoded size.
   */
  @Remote('put')
  async put(upload: WallpaperUpload): Promise<StoredWallpaper> {
    const { mediaType, base64 } = upload
    if (!MEDIA_TYPES.has(mediaType)) {
      throw new Error(`theme wallpaper: unsupported media type ${JSON.stringify(mediaType)}`)
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength === 0) throw new Error('theme wallpaper: the image is empty')
    if (bytes.byteLength > MAX_WALLPAPER_BYTES) {
      throw new Error(`theme wallpaper: the image exceeds ${String(MAX_WALLPAPER_BYTES)} bytes`)
    }
    const id = createHash('sha256').update(bytes).digest('hex') as WallpaperId
    await mkdir(this.directory, { recursive: true })
    await writeFile(join(this.directory, id), bytes)
    await writeFile(join(this.directory, `${id}.type`), mediaType)
    return { id, mediaType, bytes: bytes.byteLength }
  }

  /**
   * Read one stored image back so the tab can display it.
   * @param id - content hash returned by {@link ThemeWallpaperGateway.put}.
   * @returns the stored bytes, base64-encoded.
   */
  @Remote('get')
  async get(id: WallpaperId): Promise<string> {
    return (await readFile(join(this.directory, id))).toString('base64')
  }

  /**
   * Read one stored image's media type, which the settings document does not carry.
   * @param id - content hash returned by {@link ThemeWallpaperGateway.put}.
   * @returns the media type recorded when the image was stored.
   */
  @Remote('mediaType')
  async mediaType(id: WallpaperId): Promise<string> {
    return await readFile(join(this.directory, `${id}.type`), 'utf8')
  }
}
