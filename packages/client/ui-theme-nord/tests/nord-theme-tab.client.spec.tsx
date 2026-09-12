// @vitest-environment jsdom
/**
 * The tuner's controls: the palette rows drive edits, the background-image row
 * opens the file dialog and hands the picked file to its action, the opacity
 * slider stages a percentage, and an unwritable deployment disables the lot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { DEFAULT_PALETTE, ROLES } from '../src/palette.ts'
import { DEFAULT_WALLPAPER_OPACITY } from '../src/section.ts'
import { ROLE_LABEL } from '../src/client/locales.ts'
import type { NordThemeActions, NordThemeTabState } from '../src/client/nord-theme-controller.ts'
import { NordThemeTab } from '../src/client/NordThemeTab.tsx'
import type { NordThemeTabProps } from '../src/client/NordThemeTab.tsx'

afterEach(cleanup)

/** The tuner's copy, keyed as the dictionaries key it. */
const COPY: Record<string, string> = {
  title: 'Nord palette',
  description: 'Ten base colors and a background image.',
  light: 'Light',
  dark: 'Dark',
  reset: 'Reset to default',
  resetAll: 'Reset all to defaults',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'Not accepted.',
  readOnly: 'Read-only.',
  overridden: 'Overridden',
  wallpaperTitle: 'Background image',
  wallpaperDescription: 'Painted under the base surface.',
  wallpaperNone: 'No image selected',
  chooseImage: 'Choose image',
  removeImage: 'Remove image',
  wallpaperOpacity: 'Image opacity',
  opacityUnit: '%',
  wallpaperUploading: 'Storing the image…',
  wallpaperFailed: 'The image could not be read or stored.',
  roleBackground: 'Background',
  roleSurface: 'Surface',
  roleSurfaceRaised: 'Raised surface',
  roleSurfaceDeep: 'Deep surface',
  roleText: 'Text',
  roleAccent: 'Brand accent',
  roleAccentAlt: 'Brand accent (hover)',
  roleDanger: 'Error',
  roleSuccess: 'Success',
  roleWarning: 'Warning',
}

/**
 * Render the tuner over a real snapshot store and recorded actions.
 * @param overrides - tuner state the case under test cares about.
 * @returns the store and every action spy.
 */
function mount(overrides: Partial<NordThemeTabState> = {}) {
  const state: NordThemeTabState = {
    available: true,
    writable: true,
    dirty: false,
    saving: false,
    failed: false,
    roles: ROLES.map(role => ({
      role,
      light: DEFAULT_PALETTE[role].light,
      dark: DEFAULT_PALETTE[role].dark,
      overridden: false,
    })),
    wallpaper: false,
    wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    uploading: false,
    wallpaperFailed: false,
    wallpaperError: '',
    ...overrides,
  }
  const store = createSnapshotStore(state)
  const actions: Record<keyof NordThemeActions, ReturnType<typeof vi.fn>> = {
    edit: vi.fn(),
    resetRole: vi.fn(),
    resetAll: vi.fn(),
    chooseWallpaper: vi.fn(),
    clearWallpaper: vi.fn(),
    setWallpaperOpacity: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  }
  const props = {
    useNordTheme: bindSnapshotSelector(store),
    t: (key: string) => COPY[key] ?? key,
    ...actions,
  } as unknown as NordThemeTabProps
  render(<NordThemeTab {...props} />)
  return { store, actions, props }
}

const filePicker = (): HTMLInputElement =>
  document.querySelector('input[type="file"]') as HTMLInputElement

const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement

describe('the tuner tab', () => {
  it('renders one color pair per role, labelled and wired to the edit action', () => {
    const b = mount()
    const light = screen.getByLabelText('Background Light') as HTMLInputElement
    fireEvent.change(light, { target: { value: '#123456' } })
    expect(b.actions.edit).toHaveBeenCalledWith('background', 'light', '#123456')
    expect(screen.getByText('No image selected')).toBeDefined()
    // Every role's label key resolves through the dictionary.
    for (const role of ROLES) expect(COPY[ROLE_LABEL[role]]).toBeDefined()
  })

  it('hands a picked file to the choose action', () => {
    const b = mount()
    const picked = new File(['bytes'], 'holiday.png', { type: 'image/png' })
    fireEvent.change(filePicker(), { target: { files: [picked] } })
    expect(b.actions.chooseWallpaper).toHaveBeenCalledWith(picked)
  })

  it('opens the file dialog from the localized button, not a native label', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    mount()
    fireEvent.click(button('Choose image'))
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('stages an opacity percentage from the slider', () => {
    const b = mount({ wallpaper: true })
    fireEvent.change(screen.getByRole('slider'), { target: { value: '75' } })
    expect(b.actions.setWallpaperOpacity).toHaveBeenCalledWith(75)
    // The readout follows the store, not the click echo; number and unit are
    // separate text nodes.
    act(() => { b.store.set({ ...b.store.getSnapshot(), wallpaperOpacity: 75 }) })
    expect(document.body.textContent).toContain('75%')
  })

  it('offers removal and the slider only while an image is painted', () => {
    mount({ wallpaper: false })
    expect(button('Remove image').disabled).toBe(true)
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true)
    cleanup()
    mount({ wallpaper: true })
    expect(button('Remove image').disabled).toBe(false)
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false)
  })

  it('reports loading and failure states for the picked image', () => {
    mount({ uploading: true })
    expect(screen.getByText('Storing the image…')).toBeDefined()
    expect(button('Choose image').disabled).toBe(true)
    expect(filePicker().disabled).toBe(true)
    cleanup()
    mount({ wallpaperFailed: true })
    expect(screen.getByText('The image could not be read or stored.')).toBeDefined()
    cleanup()
    // The Host's own message rides along, so the cause is visible.
    mount({ wallpaperFailed: true, wallpaperError: 'unsupported media type "image/bmp"' })
    expect(screen.getByText(/unsupported media type/u)).toBeDefined()
  })

  it('renders nothing while the Host does not serve the namespace', () => {
    mount({ available: false })
    expect(document.querySelector('section')).toBeNull()
  })

  it('disables every control and says so on a read-only deployment', () => {
    const b = mount({ writable: false })
    expect(button('Choose image').disabled).toBe(true)
    expect(filePicker().disabled).toBe(true)
    expect((screen.getByLabelText('Background Light') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Read-only.')).toBeDefined()
    fireEvent.click(button('Save'))
    expect(b.actions.save).not.toHaveBeenCalled()
  })

  it('routes the footer actions and shows the unsaved state', () => {
    const b = mount({ dirty: true })
    expect(screen.getByText('Unsaved')).toBeDefined()
    fireEvent.click(button('Save'))
    fireEvent.click(button('Discard'))
    fireEvent.click(button('Reset all to defaults'))
    expect(b.actions.save).toHaveBeenCalledTimes(1)
    expect(b.actions.discard).toHaveBeenCalledTimes(1)
    expect(b.actions.resetAll).toHaveBeenCalledTimes(1)
  })
})
