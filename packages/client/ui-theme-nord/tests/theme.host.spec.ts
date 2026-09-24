/**
 * The Host half's contract: the settings schema defaults to the North palette,
 * and the background-image store writes content-addressed bytes under the
 * Harness home while refusing what it cannot serve.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, ROLES } from '../src/palette.ts'
import { DEFAULT_WALLPAPER_OPACITY, type NordSection } from '../src/section.ts'
import type { WallpaperId } from '../src/types.ts'
import ThemeWallpaperGateway, { Config } from '../src/index.ts'

/** Stand-in image bytes; the store never decodes what it writes. */
const BYTES = Buffer.from('nord-wallpaper-bytes')
const PNG = BYTES.toString('base64')

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-theme-nord-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

/**
 * Build the Host half over a settings registry that records the section it was
 * asked to install.
 * @returns the gateway and the section registration it performed.
 */
function gateway() {
  const installed: { namespace: string; config: NordSection }[] = []
  const ctx = new Context()
  ctx.provide('settings', {
    installSection: (_ctx: Context, namespace: string, _schema: unknown, config: NordSection) => {
      installed.push({ namespace, config })
    },
  })
  const instance = new ThemeWallpaperGateway(ctx, Config({} as unknown as NordSection))
  return { instance, installed }
}

describe('the host schema', () => {
  it('defaults every role to the North palette', () => {
    // Every field carries a default, so an empty document resolves to the
    // palette the browser half starts from.
    const resolved = Config({} as unknown as Parameters<typeof Config>[0]) as unknown as NordSection
    for (const role of ROLES) expect(resolved[role]).toEqual(DEFAULT_PALETTE[role])
    expect(resolved.wallpaper).toBe('')
    expect(resolved.wallpaperMediaType).toBe('')
    expect(resolved.wallpaperOpacity).toBe(DEFAULT_WALLPAPER_OPACITY)
  })

  it('installs the palette and wallpaper section under its own namespace', () => {
    const { installed } = gateway()
    expect(installed).toHaveLength(1)
    expect(installed[0]?.namespace).toBe('theme-nord')
  })
})

describe('the wallpaper store', () => {
  it('stores bytes by content hash and reads them back', async () => {
    const { instance } = gateway()
    const stored = await instance.put({ mediaType: 'image/png', base64: PNG })

    expect(stored.mediaType).toBe('image/png')
    expect(stored.bytes).toBe(BYTES.byteLength)
    // Content-addressed: the identity is the bytes' own digest.
    expect(await readFile(join(home, 'theme-wallpaper', stored.id))).toEqual(BYTES)
    expect(await instance.get(stored.id)).toBe(PNG)
    expect(await instance.mediaType(stored.id)).toBe('image/png')
  })

  it('stores the same image under one identity', async () => {
    const { instance } = gateway()
    const first = await instance.put({ mediaType: 'image/png', base64: PNG })
    const again = await instance.put({ mediaType: 'image/png', base64: PNG })
    expect(again.id).toBe(first.id)
  })

  it('refuses a media type it cannot serve', async () => {
    const { instance } = gateway()
    await expect(instance.put({ mediaType: 'image/tiff', base64: PNG })).rejects.toThrow(/unsupported media type/u)
  })

  it('refuses an empty image', async () => {
    const { instance } = gateway()
    await expect(instance.put({ mediaType: 'image/png', base64: '' })).rejects.toThrow(/empty/u)
  })

  it('refuses an image past the size cap, and accepts one exactly at it', async () => {
    const { instance } = gateway()
    const cap = 8 * 1024 * 1024
    const atCap = Buffer.alloc(cap, 7).toString('base64')
    expect((await instance.put({ mediaType: 'image/png', base64: atCap })).bytes).toBe(cap)
    const past = Buffer.alloc(cap + 1, 7).toString('base64')
    await expect(instance.put({ mediaType: 'image/png', base64: past })).rejects.toThrow(/exceeds/u)
  })

  it('fails loudly when a named image is not there', async () => {
    const { instance } = gateway()
    await expect(instance.get('missing' as WallpaperId)).rejects.toThrow()
  })
})
