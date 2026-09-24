/**
 * Host half of the Nord theme plugin.
 *
 * Two jobs: serve the palette settings section the browser half reads and
 * writes, and store the background image its tab uploads. The image lives as a
 * content-addressed file under the Harness home and the settings document
 * carries only its hash, so the settings wire never moves image bytes.
 *
 * A Remote boundary carries JSON only, so the image arrives and leaves
 * base64-encoded.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// Type-only: brings the `settings` service declaration (ctx.settings).
import type {} from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PALETTE } from './palette.ts'
import { DEFAULT_WALLPAPER_OPACITY, type NordSection } from './section.ts'
import type { StoredWallpaper, WallpaperId, WallpaperUpload } from './types.ts'

/** Cap on one stored image, so an upload cannot be turned into a disk-filling write. */
const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024

/** Directory under the Harness home holding stored background images. */
const WALLPAPER_DIRECTORY = 'theme-wallpaper'

/** Media types the store accepts. */
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

/** Settings namespace this plugin owns; the browser half binds the same name. */
const NORD_SETTINGS_NAMESPACE = 'theme-nord'

/**
 * One palette role's schema, defaulting to the North value.
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

/**
 * Host half: the palette settings section plus the background-image store.
 *
 * Storing by content hash makes re-picking the same image a no-op and keeps the
 * settings document free of image bytes.
 */
export default class ThemeWallpaperGateway extends TypertRemoteService {
  /** The settings registry is where this plugin's section is installed. */
  static inject = ['settings']

  /** Cordis reads the plugin's schema from this static. */
  static Config = Config

  private readonly directory: string

  /**
   * @param ctx - the host plugin context.
   * @param config - the composed defaults from the profile row.
   */
  constructor(ctx: Context, config: NordSection) {
    super(ctx, 'themeWallpaper')
    this.directory = join(resolveDshHome(), WALLPAPER_DIRECTORY)
    this.ctx.settings.installSection(this.ctx, NORD_SETTINGS_NAMESPACE, Config, config, {
      // The browser half projects the section through ctx.settingsScope, so
      // this half holds no resolved value and a committed change needs no
      // re-registration here.
      setSource: () => {},
      onChange: () => {},
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
