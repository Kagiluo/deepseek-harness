/**
 * The palette tuner's form.
 *
 * Edits are staged, not written as they settle: the layer the theme service
 * applies is rebuilt from the drafts on every keystroke so the change is
 * visible immediately, while the settings document is written only on save.
 * That keeps one gesture from becoming twenty durable mutations and lets the
 * user abandon a draft without touching what is stored.
 *
 * The background image stages the same way, with one asymmetry: the picked file
 * reaches the Host store as soon as the user picks it, because that store is
 * content-addressed and holding bytes in the browser until save would lose the
 * preview on reload. Only the settings field naming the image waits for save,
 * so a discarded pick leaves an unreferenced file rather than a wrong one.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { buildTokens, DEFAULT_PALETTE, ROLES, type ColorRole, type Palette, type Role } from '../palette.ts'
import { DEFAULT_WALLPAPER_OPACITY, type NordSection } from '../section.ts'
import { wallpaperTokens, type WallpaperId, type WallpaperPort } from './wallpaper.ts'

/** Identity of the single override layer this plugin stacks on the theme service. */
export const LAYER_SOURCE = '@deepseek-ai/dsh-client-ui-theme-nord'

/** One role as the tuner renders it. */
export interface NordRoleState {
  /** The role's key, which is also its settings field name. */
  role: Role
  /** Value the light scheme would apply, including any draft. */
  light: string
  /** Value the dark scheme would apply, including any draft. */
  dark: string
  /** Whether the stored user layer carries this role. */
  overridden: boolean
}

/** What the tuner renders. */
export interface NordThemeTabState {
  /** False while the Host does not serve the namespace; the tuner renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits a save would write. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged. */
  failed: boolean
  /** Every tunable role, in palette order. */
  roles: readonly NordRoleState[]
  /** Whether an image is painted, staged or stored. */
  wallpaper: boolean
  /** Background-image opacity as a percentage, including any draft. */
  wallpaperOpacity: number
  /** Whether an image is currently crossing to the Host store. */
  uploading: boolean
  /** Whether the last image read or store failed. */
  wallpaperFailed: boolean
  /** Why the last image read or store failed; empty while none has. */
  wallpaperError: string
}

/** The write actions the tuner's slot entry injects. */
export interface NordThemeActions {
  /** Stage one scheme's value for a role. */
  edit: (role: Role, scheme: 'light' | 'dark', value: string) => void
  /** Stage restoring one role to its built-in default. */
  resetRole: (role: Role) => void
  /** Stage restoring every role to its built-in default. */
  resetAll: () => void
  /** Store one picked image and stage it as the background. */
  chooseWallpaper: (file: File) => void
  /** Stage removing the background image. */
  clearWallpaper: () => void
  /** Stage one background-image opacity, as a percentage. */
  setWallpaperOpacity: (percent: number) => void
  /** Write every staged edit. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One staged edit. A clear re-inherits the composition default on save. */
interface Draft {
  readonly pair: ColorRole
  readonly clear: boolean
}

/**
 * One staged background-image choice. `url` is the preview the layer paints;
 * `id` stays undefined until the Host store answers, and a {@link WallpaperDraft.removal}
 * draft with an undefined `id` stages removal.
 */
interface WallpaperDraft {
  readonly id: WallpaperId | undefined
  readonly mediaType: string
  readonly url: string | undefined
  readonly removal: boolean
}

/** The slice of the theme service this plugin uses. */
interface OverrideTarget {
  overrideTokens: (source: string, tokens: Record<string, ColorRole>) => () => void
}

/** The section a deployment that has written nothing resolves to. */
const DEFAULT_SECTION: NordSection = {
  ...DEFAULT_PALETTE,
  wallpaper: '',
  wallpaperMediaType: '',
  wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
}

/**
 * The painted image's identity: which bytes the layer currently paints. A
 * stored identity is its hash and media type; a staged one is the pick that has
 * not reached the settings document yet.
 * @param kind - whether the identity names stored bytes or a staged pick.
 * @param id - content hash, or a placeholder for a staged removal.
 * @param mediaType - the media type recorded beside the hash.
 * @returns the key.
 */
function paintedIdentity(kind: 'stored' | 'staged', id: string, mediaType: string): string {
  return `${kind}\u0000${id}\u0000${mediaType}`
}

/** Bridges the `theme-nord` settings scope onto the theme service. */
export class NordThemeController {
  private readonly drafts = new Map<Role, Draft>()
  private readonly store: SnapshotStore<NordThemeTabState>
  /** Staged background-image choice; absent while the stored image stands. */
  private wallpaperDraft: WallpaperDraft | undefined
  /** Staged background-image opacity, as a percentage. */
  private wallpaperOpacityDraft: number | undefined
  /** Identity of the image {@link NordThemeController.paintedUrl} belongs to. */
  private paintedKey: string | undefined
  /** Preview URL of the painted image, when one is painted. */
  private paintedUrl: string | undefined
  /** Bumped on every read so a slower earlier answer cannot land late. */
  private readGeneration = 0
  private disposeLayer: (() => void) | undefined
  private saving = false
  private failed = false
  private uploading = false
  private wallpaperFailed = false
  private wallpaperError = ''
  private disposed = false

  /**
   * @param scope - the bound settings scope for this plugin's namespace.
   * @param theme - the theme service the layer is stacked on.
   * @param wallpaper - the port onto the Host image store.
   */
  constructor(
    private readonly scope: SettingsScope<NordSection>,
    private readonly theme: OverrideTarget,
    private readonly wallpaper: WallpaperPort,
  ) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => {
      this.syncPaintedWallpaper()
      this.applyLayer()
      this.publish()
    })
    this.syncPaintedWallpaper()
    this.applyLayer()
  }

  /**
   * Build the face the tuner's slot registration injects.
   * @returns the tuner's snapshot and its form actions.
   */
  inject(): { hooks: { nordTheme: SnapshotStore<NordThemeTabState> } } & NordThemeActions {
    return {
      hooks: { nordTheme: this.store },
      edit: (role, scheme, value) => {
        const pair = { ...this.effectiveRole(role), [scheme]: value }
        this.stage(role, { pair, clear: false })
      },
      resetRole: (role) => { this.stage(role, { pair: DEFAULT_PALETTE[role], clear: true }) },
      resetAll: () => {
        for (const role of ROLES) this.stage(role, { pair: DEFAULT_PALETTE[role], clear: true })
      },
      chooseWallpaper: (file) => { void this.chooseWallpaper(file) },
      clearWallpaper: () => {
        this.wallpaperDraft = { id: undefined, mediaType: '', url: undefined, removal: true }
        this.wallpaperFailed = false
        this.wallpaperError = ''
        this.syncPaintedWallpaper()
        this.applyLayer()
        this.publish()
      },
      setWallpaperOpacity: (percent) => {
        this.wallpaperOpacityDraft = Math.min(100, Math.max(0, percent))
        this.applyLayer()
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.drafts.size === 0 && this.wallpaperDraft === undefined
          && this.wallpaperOpacityDraft === undefined && !this.failed) return
        this.drafts.clear()
        this.wallpaperDraft = undefined
        this.wallpaperOpacityDraft = undefined
        this.failed = false
        this.wallpaperFailed = false
        this.wallpaperError = ''
        this.syncPaintedWallpaper()
        this.applyLayer()
        this.publish()
      },
    }
  }

  /** Release the override layer and the preview URL this controller owns. */
  dispose(): void {
    this.disposed = true
    this.readGeneration += 1
    this.disposeLayer?.()
    this.disposeLayer = undefined
    if (this.paintedUrl !== undefined) {
      this.wallpaper.release(this.paintedUrl)
      this.paintedUrl = undefined
    }
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted.
   *
   * The Host is the only authority on whether a value was accepted, so the
   * outcome is read back from the section rather than predicted here. A save
   * that did not land keeps its drafts so the user can correct them.
   * @returns settlement after every write.
   */
  async save(): Promise<void> {
    if ((this.drafts.size === 0 && this.wallpaperDraft === undefined
      && this.wallpaperOpacityDraft === undefined) || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const [role, draft] of [...this.drafts]) {
      if (draft.clear) {
        await this.scope.unset(role)
        landed = !this.stored(role) && landed
      } else {
        await this.scope.set(role, draft.pair)
        landed = this.stored(role) && landed
      }
    }
    if (this.wallpaperDraft !== undefined && this.wallpaperDraft.removal) {
      await this.scope.set('wallpaper', '')
      await this.scope.set('wallpaperMediaType', '')
      landed = this.section().wallpaper === '' && landed
    } else if (this.wallpaperDraft?.id !== undefined) {
      const { id, mediaType } = this.wallpaperDraft
      await this.scope.set('wallpaper', id)
      await this.scope.set('wallpaperMediaType', mediaType)
      landed = this.section().wallpaper === id && landed
    }
    if (this.wallpaperOpacityDraft !== undefined) {
      await this.scope.set('wallpaperOpacity', this.wallpaperOpacityDraft)
      landed = this.section().wallpaperOpacity === this.wallpaperOpacityDraft && landed
    }
    if (landed) {
      this.drafts.clear()
      this.adoptStagedWallpaper()
      this.wallpaperOpacityDraft = undefined
    }
    this.saving = false
    this.failed = !landed
    this.applyLayer()
    this.publish()
  }

  /**
   * Stage one picked image and store its bytes on the Host.
   *
   * The preview is painted before the bytes cross, so the pick is acknowledged
   * while the store runs; the identity the settings document will carry arrives
   * with the store's answer. A store failure drops the pick, which returns the
   * background to whatever the document names.
   * @param file - the image the user picked.
   */
  private async chooseWallpaper(file: File): Promise<void> {
    if (this.disposed || this.uploading) return
    const url = this.wallpaper.preview(file)
    if (this.disposed) {
      this.wallpaper.release(url)
      return
    }
    this.wallpaperDraft = { id: undefined, mediaType: file.type, url, removal: false }
    this.uploading = true
    this.wallpaperFailed = false
    this.wallpaperError = ''
    this.syncPaintedWallpaper()
    this.applyLayer()
    this.publish()
    let stored
    try {
      stored = await this.wallpaper.store(file)
    } catch (error) {
      /* Only the Host store's own rejection reaches here; the failure is
         reported with its own message and the stored background is unchanged. */
      if (this.disposed) return
      this.uploading = false
      this.wallpaperDraft = undefined
      this.failWallpaper(error)
      this.syncPaintedWallpaper()
      this.applyLayer()
      this.publish()
      return
    }
    if (this.disposed) return
    this.uploading = false
    this.wallpaperDraft = { id: stored.id, mediaType: stored.mediaType, url, removal: false }
    this.syncPaintedWallpaper()
    this.applyLayer()
    this.publish()
  }

  /**
   * Report a failed image operation with the message it failed with, so the
   * tuner names the cause instead of a bare failure.
   * @param error - what the port threw.
   */
  private failWallpaper(error: unknown): void {
    this.wallpaperFailed = true
    this.wallpaperError = error instanceof Error ? error.message : String(error)
  }

  /** Rebuild the override layer from the drafts over the stored section. */
  private applyLayer(): void {
    const palette = this.effective()
    this.disposeLayer = this.theme.overrideTokens(LAYER_SOURCE, {
      ...buildTokens(palette),
      ...wallpaperTokens(palette.background, this.paintedUrl, this.effectiveWallpaperOpacity()),
    })
  }

  /**
   * Paint the image the effective selection names, reading it from the Host the
   * first time the settings document points at it.
   *
   * A read is attempted once per stored identity: the layer keeps painting the
   * palette without an image until the user picks another one, and the failure
   * is reported rather than retried on every settings write.
   */
  private syncPaintedWallpaper(): void {
    const draft = this.wallpaperDraft
    if (draft !== undefined) {
      this.paint(
        paintedIdentity('staged', draft.id ?? '', draft.mediaType),
        draft.url,
      )
      return
    }
    const section = this.section()
    const id = section.wallpaper
    if (id === '') {
      this.paint(paintedIdentity('stored', '', ''), undefined)
      return
    }
    const key = paintedIdentity('stored', id, section.wallpaperMediaType)
    if (key === this.paintedKey) return
    const generation = ++this.readGeneration
    void this.wallpaper.read(id as WallpaperId, section.wallpaperMediaType).then(
      (url) => {
        if (this.disposed || generation !== this.readGeneration) {
          this.wallpaper.release(url)
          return
        }
        this.paint(key, url)
        this.applyLayer()
        this.publish()
      },
      (error: unknown) => {
        /* Only the Host read's own rejection reaches here; the identity is
           recorded so the next settings write does not retry it. */
        if (this.disposed || generation !== this.readGeneration) return
        this.paintedKey = key
        this.failWallpaper(error)
        this.publish()
      },
    )
  }

  /**
   * Replace the painted image, releasing the URL it replaces.
   * @param key - identity of the image being painted.
   * @param url - its preview URL, or undefined when no image is painted.
   */
  private paint(key: string, url: string | undefined): void {
    if (key === this.paintedKey) return
    this.paintedKey = key
    if (this.paintedUrl !== undefined) this.wallpaper.release(this.paintedUrl)
    this.paintedUrl = url
  }

  /**
   * Keep painting the staged preview after a save, and record the identity the
   * Host now stores: the staged bytes are the stored bytes, so reading them
   * back would only cost a round trip.
   */
  private adoptStagedWallpaper(): void {
    const draft = this.wallpaperDraft
    if (draft === undefined) return
    this.wallpaperDraft = undefined
    if (draft.removal) {
      this.paintedKey = paintedIdentity('stored', '', '')
      return
    }
    /* v8 ignore next -- save() writes nothing for a draft whose store has not answered, so it is never adopted. */
    if (draft.id === undefined) return
    this.paintedKey = paintedIdentity('stored', draft.id, draft.mediaType)
  }

  /** The background-image opacity with any draft applied. */
  private effectiveWallpaperOpacity(): number {
    return this.wallpaperOpacityDraft ?? this.section().wallpaperOpacity
  }

  /** One role's value with any draft applied. */
  private effectiveRole(role: Role): ColorRole {
    const draft = this.drafts.get(role)
    if (draft === undefined) return this.stored(role) ? this.section()[role] : DEFAULT_PALETTE[role]
    return draft.clear ? DEFAULT_PALETTE[role] : draft.pair
  }

  /** The whole palette with every draft applied. */
  private effective(): Palette {
    return Object.fromEntries(ROLES.map(role => [role, this.effectiveRole(role)])) as Palette
  }

  /** The resolved section, falling back to the defaults before it arrives. */
  private section(): NordSection {
    return this.scope.getSnapshot().value ?? DEFAULT_SECTION
  }

  /** Whether the stored user layer carries one role. */
  private stored(role: Role): boolean {
    const user = this.scope.getSnapshot().user as Record<string, unknown> | undefined
    return user !== undefined && Object.hasOwn(user, role)
  }

  private stage(role: Role, draft: Draft): void {
    this.drafts.set(role, draft)
    this.failed = false
    this.applyLayer()
    this.publish()
  }

  private projection(): NordThemeTabState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.drafts.size > 0 || this.wallpaperDraft !== undefined
        || this.wallpaperOpacityDraft !== undefined,
      saving: this.saving,
      failed: this.failed,
      roles: ROLES.map((role) => {
        const pair = this.effectiveRole(role)
        return { role, light: pair.light, dark: pair.dark, overridden: this.stored(role) }
      }),
      wallpaper: this.paintedUrl !== undefined,
      wallpaperOpacity: this.effectiveWallpaperOpacity(),
      uploading: this.uploading,
      wallpaperFailed: this.wallpaperFailed,
      wallpaperError: this.wallpaperError,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
