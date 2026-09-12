/**
 * The palette's contract: the derived layer covers exactly the ui-theme token
 * sheet, and the tuner previews immediately while writing only on save. The
 * background image follows the same staging, with the Host store reached ahead
 * of the settings write.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { describe, expect, it, vi } from 'vitest'
import { buildTokens, DEFAULT_PALETTE, type ColorRole } from '../src/palette.ts'
import { DEFAULT_WALLPAPER_OPACITY, type NordSection } from '../src/section.ts'
import { NordThemeController } from '../src/client/nord-theme-controller.ts'
import { wallpaperTokens, type WallpaperId, type WallpaperPort } from '../src/client/wallpaper.ts'

/** The ui-theme sheet this palette claims to cover. */
function declaredTokens(): Set<string> {
  const sheet = readFileSync(
    fileURLToPath(new URL('../../ui-theme/src/styles/design-platform.css', import.meta.url)),
    'utf8',
  )
  return new Set([...sheet.matchAll(/--dsw-(?:alias|specific)-[a-z0-9-]+(?=\s*:)/gu)].map(match => match[0]))
}

/** The section an unwritten document resolves to. */
const DEFAULT_SECTION: NordSection = {
  ...DEFAULT_PALETTE,
  wallpaper: '',
  wallpaperMediaType: '',
  wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
}

/** A settings scope stub that records what the controller writes. */
function scopeStub(initial: Partial<NordSection> = {}) {
  let value = { ...DEFAULT_SECTION, ...initial }
  let user: Record<string, unknown> = Object.fromEntries(Object.keys(initial).map(key => [key, true]))
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  const writes: { field: string; value: unknown }[] = []
  const unsets: string[] = []
  return {
    writes,
    unsets,
    getSnapshot: () => ({ status: 'ready' as const, writable: true, value, base: DEFAULT_SECTION, user }),
    set: async (field: string, next: unknown): Promise<void> => {
      writes.push({ field, value: next })
      user = { ...user, [field]: next }
      value = { ...value, [field]: next } as NordSection
      notify()
    },
    unset: async (field: string): Promise<void> => {
      unsets.push(field)
      const { [field]: _dropped, ...rest } = user
      user = rest
      notify()
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

/** A theme service stub that keeps every layer it was handed. */
function themeStub() {
  const layers: Record<string, ColorRole>[] = []
  return {
    layers,
    overrideTokens: vi.fn((_source: string, tokens: Record<string, ColorRole>) => {
      layers.push(tokens)
      return () => {}
    }),
  }
}

/** A wallpaper port stub: content-addressed stores, previews, and a release log. */
function wallpaperStub() {
  const released: string[] = []
  const store = vi.fn(async (file: File) => ({
    id: `hash-${file.name}` as WallpaperId,
    mediaType: file.type,
    bytes: file.size,
  }))
  // `new File` is the browser constructor; these specs run on node, so the
  // port is fed a File-shaped value the controller only reads name/type from.
  const file = (name: string, type = 'image/png'): File => ({ name, type, size: 3 }) as File
  return {
    released,
    store,
    file,
    port: {
      store,
      read: vi.fn(async (id: WallpaperId) => `blob:stored-${id}`),
      preview: vi.fn((picked: File) => `blob:staged-${picked.name}`),
      release: vi.fn((url: string) => { released.push(url) }),
    } satisfies WallpaperPort,
  }
}

const SCOPE = (stub: ReturnType<typeof scopeStub>): SettingsScope<NordSection> =>
  stub as unknown as SettingsScope<NordSection>

describe('the derived layer', () => {
  it('covers exactly the tokens the ui-theme sheet declares', () => {
    const declared = declaredTokens()
    expect(declared.size).toBeGreaterThan(0)
    // A name the sheet does not declare would silently change nothing; a name
    // it declares but this palette omits would keep a base-palette value.
    expect(Object.keys(buildTokens(DEFAULT_PALETTE)).sort()).toEqual([...declared].sort())
  })

  it('gives every token a value in both schemes', () => {
    for (const [token, pair] of Object.entries(buildTokens(DEFAULT_PALETTE))) {
      expect(token).toMatch(/^--dsw-(?:alias|specific)-/u)
      expect(typeof pair.light).toBe('string')
      expect(typeof pair.dark).toBe('string')
    }
  })

  it('moves every derived token when its role changes', () => {
    const retuned = buildTokens({ ...DEFAULT_PALETTE, accent: { light: '#123456', dark: '#654321' } })
    expect(retuned['--dsw-alias-brand-primary']).toEqual({ light: '#123456', dark: '#654321' })
    expect(retuned['--dsw-alias-link']).toEqual({ light: '#123456', dark: '#654321' })
    expect(retuned['--dsw-specific-sidebar-nav-item-active']?.light).toContain('18, 52, 86')
  })
})

describe('the wallpaper tokens', () => {
  it('gives up exactly the image opacity on the base surface', () => {
    const tokens = wallpaperTokens(DEFAULT_PALETTE.background, 'blob:image', 40)
    expect(tokens['--dsw-alias-bg-base']?.light).toContain('60%, transparent')
    expect(tokens['--dsw-alias-bg-base']?.dark).toContain('60%, transparent')
    expect(tokens['--dsh-nord-wallpaper']).toEqual({ light: 'url("blob:image")', dark: 'url("blob:image")' })
    expect(tokens['--dsh-nord-wallpaper-opacity']).toEqual({ light: '0.4', dark: '0.4' })
  })

  it('keeps the base surface opaque while no image is painted', () => {
    for (const tokens of [
      wallpaperTokens(DEFAULT_PALETTE.background, undefined, 40),
      wallpaperTokens(DEFAULT_PALETTE.background, 'blob:image', 0),
    ]) {
      expect(tokens['--dsw-alias-bg-base']).toEqual(DEFAULT_PALETTE.background)
      expect(tokens['--dsh-nord-wallpaper']).toEqual({ light: 'none', dark: 'none' })
    }
  })

  it('keeps the floor opaque in both schemes so the window never shows through', () => {
    expect(wallpaperTokens(DEFAULT_PALETTE.background, 'blob:image', 40)['--dsh-nord-floor'])
      .toEqual(DEFAULT_PALETTE.background)
  })
})

describe('the tuner', () => {
  it('applies the stored palette on construction', () => {
    const scope = scopeStub()
    const theme = themeStub()
    new NordThemeController(SCOPE(scope), theme, wallpaperStub().port)
    expect(theme.layers).toHaveLength(1)
    expect(theme.layers[0]?.['--dsw-alias-bg-base']).toEqual(DEFAULT_PALETTE.background)
  })

  it('previews an edit before it is saved, and writes it only on save', async () => {
    const scope = scopeStub()
    const theme = themeStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaperStub().port)
    const face = controller.inject()

    face.edit('accent', 'light', '#101010')
    expect(theme.layers.at(-1)?.['--dsw-alias-brand-primary']?.light).toBe('#101010')
    expect(scope.writes).toHaveLength(0)
    expect(face.hooks.nordTheme.getSnapshot().dirty).toBe(true)

    await controller.save()
    expect(scope.writes).toHaveLength(1)
    expect(scope.writes[0]?.field).toBe('accent')
    expect(scope.getSnapshot().value.accent.light).toBe('#101010')
    expect(face.hooks.nordTheme.getSnapshot().dirty).toBe(false)
  })

  it('restores a role by clearing its stored override', async () => {
    const scope = scopeStub({ accent: { light: '#101010', dark: '#202020' } })
    const theme = themeStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaperStub().port)
    const face = controller.inject()

    face.resetRole('accent')
    expect(theme.layers.at(-1)?.['--dsw-alias-brand-primary']).toEqual(DEFAULT_PALETTE.accent)
    await controller.save()
    expect(scope.unsets).toContain('accent')
    expect(scope.getSnapshot().user).not.toHaveProperty('accent')
  })

  it('drops drafts on discard without touching the stored value', () => {
    const scope = scopeStub()
    const theme = themeStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaperStub().port)
    const face = controller.inject()

    face.edit('text', 'dark', '#ABCDEF')
    face.discard()
    expect(theme.layers.at(-1)?.['--dsw-alias-label-primary']).toEqual(DEFAULT_PALETTE.text)
    expect(face.hooks.nordTheme.getSnapshot().dirty).toBe(false)
  })

  it('paints the stored image once the Host hands it over', async () => {
    const scope = scopeStub({ wallpaper: 'stored-hash', wallpaperMediaType: 'image/webp' })
    const theme = themeStub()
    const wallpaper = wallpaperStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaper.port)

    await vi.waitFor(() => {
      expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']?.light).toBe('url("blob:stored-stored-hash")')
    })
    expect(wallpaper.port.read).toHaveBeenCalledWith('stored-hash', 'image/webp')
    expect(controller.inject().hooks.nordTheme.getSnapshot().wallpaper).toBe(true)
  })

  it('stores a picked image before staging it, and writes the reference on save', async () => {
    const scope = scopeStub()
    const theme = themeStub()
    const wallpaper = wallpaperStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaper.port)
    const face = controller.inject()
    const picked = wallpaper.file('holiday.png')

    face.chooseWallpaper(picked)
    await vi.waitFor(() => { expect(wallpaper.store).toHaveBeenCalledWith(picked) })
    await vi.waitFor(() => {
      expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']?.light).toBe('url("blob:staged-holiday.png")')
    })
    // The bytes crossed to the Host; the settings document has not moved.
    expect(scope.writes).toHaveLength(0)
    expect(face.hooks.nordTheme.getSnapshot().dirty).toBe(true)

    await controller.save()
    expect(scope.writes).toEqual([
      { field: 'wallpaper', value: 'hash-holiday.png' },
      { field: 'wallpaperMediaType', value: 'image/png' },
    ])
    // The staged preview is the stored image, so it is not read back.
    expect(wallpaper.port.read).not.toHaveBeenCalled()
    expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']?.light).toBe('url("blob:staged-holiday.png")')
  })

  it('restores the stored image when a staged pick is discarded', async () => {
    const scope = scopeStub({ wallpaper: 'stored-hash', wallpaperMediaType: 'image/png' })
    const theme = themeStub()
    const wallpaper = wallpaperStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaper.port)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.nordTheme.getSnapshot().wallpaper).toBe(true) })

    face.chooseWallpaper(wallpaper.file('other.png'))
    await vi.waitFor(() => {
      expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']?.light).toBe('url("blob:staged-other.png")')
    })
    face.discard()
    // Dropping the pick restores the stored image, which the controller reads
    // again because the staged preview replaced the URL it had.
    await vi.waitFor(() => {
      expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']?.light).toBe('url("blob:stored-stored-hash")')
    })
    expect(wallpaper.released).toContain('blob:staged-other.png')
    expect(scope.writes).toHaveLength(0)
  })

  it('stages removal without reading the image back again', async () => {
    const scope = scopeStub({ wallpaper: 'stored-hash', wallpaperMediaType: 'image/png' })
    const theme = themeStub()
    const wallpaper = wallpaperStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaper.port)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.nordTheme.getSnapshot().wallpaper).toBe(true) })

    face.clearWallpaper()
    expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']).toEqual({ light: 'none', dark: 'none' })
    expect(theme.layers.at(-1)?.['--dsw-alias-bg-base']).toEqual(DEFAULT_PALETTE.background)
    expect(wallpaper.released).toContain('blob:stored-stored-hash')

    await controller.save()
    expect(scope.writes).toEqual([
      { field: 'wallpaper', value: '' },
      { field: 'wallpaperMediaType', value: '' },
    ])
  })

  it('previews a staged opacity and persists it on save', async () => {
    const scope = scopeStub({ wallpaper: 'stored-hash', wallpaperMediaType: 'image/png' })
    const theme = themeStub()
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaperStub().port)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.nordTheme.getSnapshot().wallpaper).toBe(true) })

    face.setWallpaperOpacity(75)
    expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper-opacity']).toEqual({ light: '0.75', dark: '0.75' })
    expect(theme.layers.at(-1)?.['--dsw-alias-bg-base']?.light).toContain('25%, transparent')
    expect(scope.writes).toHaveLength(0)

    await controller.save()
    expect(scope.writes).toEqual([{ field: 'wallpaperOpacity', value: 75 }])
    expect(face.hooks.nordTheme.getSnapshot().wallpaperOpacity).toBe(75)
  })

  it('reports a failed store and leaves the painted background alone', async () => {
    const scope = scopeStub({ wallpaper: 'stored-hash', wallpaperMediaType: 'image/png' })
    const theme = themeStub()
    const wallpaper = wallpaperStub()
    wallpaper.port.store.mockRejectedValueOnce(new Error('too large'))
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaper.port)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.nordTheme.getSnapshot().wallpaper).toBe(true) })

    face.chooseWallpaper(wallpaper.file('huge.png'))
    await vi.waitFor(() => { expect(face.hooks.nordTheme.getSnapshot().wallpaperFailed).toBe(true) })
    const state = face.hooks.nordTheme.getSnapshot()
    expect(state.uploading).toBe(false)
    expect(state.dirty).toBe(false)
    expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']?.light).toBe('url("blob:stored-stored-hash")')
  })

  it('reports an unreadable stored image without retrying it on every write', async () => {
    const scope = scopeStub({ wallpaper: 'gone', wallpaperMediaType: 'image/png' })
    const theme = themeStub()
    const wallpaper = wallpaperStub()
    wallpaper.port.read.mockRejectedValue(new Error('missing'))
    const controller = new NordThemeController(SCOPE(scope), theme, wallpaper.port)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.nordTheme.getSnapshot().wallpaperFailed).toBe(true) })

    expect(theme.layers.at(-1)?.['--dsh-nord-wallpaper']).toEqual({ light: 'none', dark: 'none' })
    face.edit('accent', 'light', '#101010')
    expect(wallpaper.port.read).toHaveBeenCalledTimes(1)
  })

  it('releases the layer and the painted URL on dispose', () => {
    const releases = vi.fn()
    const scope = scopeStub()
    const wallpaper = wallpaperStub()
    const controller = new NordThemeController(
      SCOPE(scope),
      { overrideTokens: () => releases },
      wallpaper.port,
    )
    controller.dispose()
    expect(releases).toHaveBeenCalledTimes(1)
  })
})
