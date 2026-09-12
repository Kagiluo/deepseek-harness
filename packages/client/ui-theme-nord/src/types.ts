/**
 * Protocol types for the wallpaper store, shared by both faces of this
 * package: the Host service implements them and the browser half consumes the
 * generated `./remote` client for them.
 *
 * A Remote boundary carries JSON only, so image bytes travel base64-encoded
 * rather than as a `Uint8Array`.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one stored wallpaper image (its content hash). */
export type WallpaperId = Branded<'WallpaperId'>

/** What the browser must send to store one wallpaper image. */
export interface WallpaperUpload {
  /** Media type of the bytes, as the browser reported it. */
  readonly mediaType: string
  /** Image bytes, base64-encoded without a data-URL prefix. */
  readonly base64: string
}

/** One stored wallpaper image, addressed by its content hash. */
export interface StoredWallpaper {
  /** Content hash addressing the stored bytes. */
  readonly id: WallpaperId
  /** Media type recorded when the image was stored. */
  readonly mediaType: string
  /** Decoded byte length, so the browser can size its object URL. */
  readonly bytes: number
}
