// @vitest-environment jsdom
/**
 * The plugin's apply wiring, exercised against a real cordis Context: it stacks
 * its layer, installs its stylesheet, registers dictionaries and the tuner tab,
 * and stores a picked image through the `remote.<namespace>` service the Client
 * assembly provides — the key a fiber may only read through `ctx.get`.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_PALETTE, type ColorRole } from '../src/palette.ts'
import { DEFAULT_WALLPAPER_OPACITY, type NordSection } from '../src/section.ts'
import { apply, inject, name } from '../src/client/index.ts'
import type { NordThemeKey } from '../src/client/locales.ts'
import { LAYER_SOURCE, type NordThemeTabState } from '../src/client/nord-theme-controller.ts'
import { NordThemeTab } from '../src/client/NordThemeTab.tsx'
import type { NordThemeTabProps } from '../src/client/NordThemeTab.tsx'

const TAB = 'settings.plugins.tab'
const PUT_ID = 'stored-hash'

afterEach(cleanup)

/** The section a deployment that has written nothing resolves to. */
const SECTION: NordSection = {
  ...DEFAULT_PALETTE,
  wallpaper: '',
  wallpaperMediaType: '',
  wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
}

/** A settings scope whose stored values the bench updates directly. */
function scopeStub(value: NordSection = SECTION) {
  let current = value
  let user: Record<string, unknown> = {}
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  const scope = {
    writes,
    set current(next: NordSection) { current = next; for (const listener of listeners) listener() },
    getSnapshot: () => ({ status: 'ready' as const, writable: true, value: current, base: SECTION, user }),
    set: async (field: string, next: unknown): Promise<void> => {
      writes.push({ field, value: next })
      user = { ...user, [field]: next }
      current = { ...current, [field]: next } as NordSection
      for (const listener of listeners) listener()
    },
    unset: async (field: string): Promise<void> => {
      const { [field]: _dropped, ...rest } = user
      user = rest
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return scope
}

/**
 * Boot the plugin the way the shell does: the services it injects are provided
 * by other plugins, and the Remote namespace arrives under its own key.
 * @param options - whether the Remote namespace is provided at all.
 * @returns the context, the services it provided, and the layer the theme recorded.
 */
async function bench(options: { namespace?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)

  const layers: { source: string; tokens: Record<string, ColorRole> }[] = []
  ctx.provide('theme', {
    overrideTokens: (source: string, tokens: Record<string, ColorRole>) => {
      layers.push({ source, tokens })
      return () => {}
    },
  })
  const scope = scopeStub()
  ctx.provide('settingsScope', { bind: () => scope as unknown as SettingsScope<NordSection> })

  const puts: { mediaType: string; base64: string }[] = []
  const namespace = {
    async put(upload: { mediaType: string; base64: string }) {
      puts.push(upload)
      return { ok: true as const, value: { id: PUT_ID, mediaType: upload.mediaType, bytes: 3 } }
    },
    async get() { return { ok: true as const, value: '' } },
    async mediaType() { return { ok: true as const, value: 'image/png' } },
  }
  // The context proxy names the assembly's namespace service; it is provided
  // under `remote.<namespace>`, while `remote` itself is an injected service.
  ctx.provide('remote', {})
  if (options.namespace !== false) ctx.provide('remote.themeWallpaper', namespace)

  const slots = ctx.get('slots') as SlotRegistry
  const host = slots.register(
    { name: 'root', children: { [TAB]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, locale, scope, layers, puts, host, fiber }
}

/** Stand in for the settings shell: declare the Plugins tab slot from root. */
function declareTab(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [TAB]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

describe('the plugin apply', () => {
  it('declares the services it reads', () => {
    expect(inject).toEqual(['theme', 'slots', 'locale', 'remote', 'settingsScope'])
    expect(name).toBe('@deepseek-ai/dsh-client-ui-theme-nord')
  })

  it('stacks one override layer, installs its stylesheet, and registers the tab', async () => {
    const b = await bench()
    expect(b.layers[0]?.source).toBe(LAYER_SOURCE)
    expect(b.layers[0]?.tokens['--dsw-alias-bg-base']).toEqual(DEFAULT_PALETTE.background)
    const tags = [...document.head.querySelectorAll('style')]
      .filter(tag => tag.dataset.pluginCss === `${name}/wallpaper.css`)
    expect(tags).toHaveLength(1)
    const entry = b.slots.entries(TAB).find(e => e.component === NordThemeTab)
    expect(entry?.options).toMatchObject({ id: 'nord-theme', order: 20 })
    expect(b.locale.bind('nordTheme')('title')).toBe('Nord 配色')
    // The tab's face is built from the controller, not a frozen literal.
    const face = (entry?.inject as unknown as () => { hooks: unknown })()
    expect(face.hooks).toBeDefined()
  })

  it('stores a picked image through the mounted remote namespace', async () => {
    const b = await bench()
    const entry = b.slots.entries(TAB).find(e => e.component === NordThemeTab)!
    const face = (entry.inject as unknown as () => {
      hooks: { nordTheme: { getSnapshot: () => NordThemeTabState } }
      chooseWallpaper: (file: File) => void
    })()
    const picked = new File(['png'], 'holiday.png', { type: 'image/png' })
    face.chooseWallpaper(picked)
    await vi.waitFor(() => { expect(b.puts).toHaveLength(1) })
    expect(b.puts[0]?.mediaType).toBe('image/png')
    expect(b.puts[0]?.base64).toBe(btoa('png'))
    // The pick is staged, and the layer paints it before the settings write.
    await vi.waitFor(() => {
      expect(b.layers.at(-1)?.tokens['--dsh-nord-wallpaper']?.light).toMatch(/^url\("blob:/u)
    })
  })

  it('reports an unmounted namespace rather than failing silently', async () => {
    const b = await bench({ namespace: false })
    const entry = b.slots.entries(TAB).find(e => e.component === NordThemeTab)!
    const face = (entry.inject as unknown as () => {
      hooks: { nordTheme: { getSnapshot: () => NordThemeTabState } }
      chooseWallpaper: (file: File) => void
    })()
    face.chooseWallpaper(new File(['png'], 'holiday.png', { type: 'image/png' }))
    await vi.waitFor(() => {
      expect(face.hooks.nordTheme.getSnapshot().wallpaperFailed).toBe(true)
    })
    expect(face.hooks.nordTheme.getSnapshot().wallpaperError).toMatch(/not mounted/u)
  })

  it('drops the stylesheet and the layer when the plugin unloads', async () => {
    const b = await bench()
    const tags = (): number => [...document.head.querySelectorAll('style')]
      .filter(tag => tag.dataset.pluginCss === `${name}/wallpaper.css`).length
    const before = tags()
    expect(before).toBeGreaterThan(0)
    await b.fiber.dispose()
    expect(tags()).toBe(before - 1)
    // The tab entry collapses with the fiber.
    expect(b.slots.entries(TAB).some(e => e.component === NordThemeTab)).toBe(false)
  })

  it('registers the tab declared after apply, and survives an HMR collapse', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('theme', { overrideTokens: () => () => {} })
    ctx.provide('settingsScope', { bind: () => scopeStub() as unknown as SettingsScope<NordSection> })
    ctx.provide('remote', {})
    ctx.provide('remote.themeWallpaper', {})
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries(TAB)).toHaveLength(0)
    const host = declareTab(slots)
    await Promise.resolve()
    expect(slots.entries(TAB).some(e => e.component === NordThemeTab)).toBe(true)
    host()
    expect(slots.entries(TAB)).toHaveLength(0)
    declareTab(slots)
    await Promise.resolve()
    expect(slots.entries(TAB).some(e => e.component === NordThemeTab)).toBe(true)
  })

  it('renders the tuner from the registered entry and stores the picked file', async () => {
    const b = await bench()
    const entry = b.slots.entries(TAB).find(e => e.component === NordThemeTab)!
    const face = (entry.inject as unknown as () => Record<string, unknown>)()
    const store = (face as { hooks: { nordTheme: { getSnapshot: () => NordThemeTabState } } }).hooks.nordTheme
    const props = {
      ...face,
      useNordTheme: <Selected,>(selector: (state: NordThemeTabState) => Selected): Selected =>
        selector(store.getSnapshot()),
      t: (key: NordThemeKey) => b.locale.bind('nordTheme')(key),
    } as unknown as NordThemeTabProps
    render(<NordThemeTab {...props} />)
    expect(screen.getByText('Nord 配色')).toBeDefined()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] },
    })
    await vi.waitFor(() => { expect(b.puts).toHaveLength(1) })
  })
})
