/**
 * The background-image feature's browser-side machinery: the port onto the Host
 * image store, the base64 codec its Remote boundary requires, and the tokens
 * the wallpaper layers read.
 *
 * The controller reaches the Host only through {@link WallpaperPort}, so its
 * staging and preview logic carries no base64, Blob, or Remote detail.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ColorRole } from '../palette.ts'

/**
 * The generated Host namespace backing this feature, as the Client assembly
 * declares it.
 *
 * It is read off the assembly rather than restated here so the wire types keep
 * one home. This half does not compile the module that declares them: both
 * faces emitting the same declaration file would make one build overwrite the
 * other's input.
 */
export type WallpaperNamespace = ClientRemote['themeWallpaper']

/** Stable identity of one stored wallpaper image, branded by the Host signature. */
export type WallpaperId = Parameters<WallpaperNamespace['get']>[0]

/** One stored image, as the Host reports it back. */
type StoredWallpaper = Extract<
  Awaited<ReturnType<WallpaperNamespace['put']>>,
  { readonly ok: true }
>['value']

/** What the tuner uses from the Host image store. */
export interface WallpaperPort {
  /**
   * Store one file the user chose.
   * @param file - the picked image, as the browser reported it.
   * @returns the stored image's identity and decoded size.
   */
  store(file: File): Promise<StoredWallpaper>
  /**
   * Read one stored image back as a URL the wallpaper layer can paint.
   * @param id - content hash recorded in the settings document.
   * @param mediaType - media type recorded alongside it.
   * @returns an object URL owned by this port until {@link WallpaperPort.release}.
   */
  read(id: WallpaperId, mediaType: string): Promise<string>
  /**
   * Build the preview URL for a file the user just picked, before the reference
   * that names it is saved.
   * @param file - the picked image.
   * @returns an object URL owned by this port until {@link WallpaperPort.release}.
   */
  preview(file: File): string
  /**
   * Release one URL this port handed out.
   * @param url - a URL from {@link WallpaperPort.read} or {@link WallpaperPort.preview}.
   */
  release(url: string): void
}

/** File-read chunk size: `String.fromCharCode` takes the argument list on the stack. */
const BASE64_CHUNK = 0x8000

/**
 * Encode one file's bytes for the JSON-only Remote boundary.
 * @param file - the picked image.
 * @returns the file's bytes, base64-encoded.
 */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}

/**
 * Decode bytes that crossed the Remote boundary.
 * @param base64 - the value a Remote method returned.
 * @returns the decoded bytes.
 */
function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Resolve the Host namespace when a call needs it. */
export type WallpaperNamespaceRef = () => WallpaperNamespace | undefined

/**
 * Bind this feature onto the Host namespace it calls.
 * @param namespace - resolves the generated `themeWallpaper` namespace on demand.
 * @returns the port the tuner stores and reads images through.
 */
export function createWallpaperPort(namespace: WallpaperNamespaceRef): WallpaperPort {
  // Resolved per call rather than captured: the application's Client assembly
  // mounts the namespace from its own plugin's apply, so this plugin may
  // activate before the namespace exists.
  const resolve = (): WallpaperNamespace => {
    const remote = namespace()
    if (remote === undefined) throw new Error('the themeWallpaper namespace is not mounted')
    return remote
  }
  return {
    async store(file) {
      const result = await resolve().put({ mediaType: file.type, base64: await base64Of(file) })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    async read(id, mediaType) {
      const result = await resolve().get(id)
      if (!result.ok) throw new Error(result.error.message)
      return URL.createObjectURL(new Blob([bytesOf(result.value)], { type: mediaType }))
    },
    preview(file) {
      return URL.createObjectURL(file)
    },
    release(url) {
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * The tokens the wallpaper layers read, plus the base-surface alpha that lets
 * the image through the shell frame.
 *
 * The floor and image layers sit below every in-flow element, so the image is
 * only ever visible where a surface keeps some transparency: the base surface
 * gives up exactly the image's opacity, and the raised surfaces stay opaque.
 * @param background - the palette's base background role, opaque.
 * @param url - object URL of the image to paint, or undefined when none is set.
 * @param opacity - the image's opacity as a percentage.
 * @returns token name to per-scheme value.
 */
export function wallpaperTokens(
  background: ColorRole,
  url: string | undefined,
  opacity: number,
): Record<string, ColorRole> {
  const percent = Math.min(100, Math.max(0, opacity))
  const opaque: ColorRole = { light: background.light, dark: background.dark }
  // An image nobody can see is not painted at all: at zero opacity the layer
  // would still decode and composite the bytes.
  const paints = url !== undefined && percent > 0
  const base: ColorRole = paints ? {
    light: `color-mix(in srgb, ${background.light} ${String(100 - percent)}%, transparent)`,
    dark: `color-mix(in srgb, ${background.dark} ${String(100 - percent)}%, transparent)`,
  } : opaque
  const image = paints ? `url("${url}")` : 'none'
  return {
    '--dsw-alias-bg-base': base,
    '--dsh-nord-floor': opaque,
    '--dsh-nord-wallpaper': { light: image, dark: image },
    '--dsh-nord-wallpaper-opacity': { light: String(percent / 100), dark: String(percent / 100) },
  }
}
