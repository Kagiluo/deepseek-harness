/**
 * `nordTheme` namespace dictionaries, and the namespace's declaration.
 *
 * The namespace merge lives with its key set so that any module naming
 * `PropsLocale<'nordTheme'>` needs only this file. Each tunable role's label key
 * lives here too: the keys are dictionary entries, so they belong beside them
 * rather than in the component that renders them.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Role } from '../palette.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Palette tuner copy: role labels, field labels, and the save states. */
    nordTheme: NordThemeKey
  }
}

/** One label key per tunable role, in palette order. */
export const ROLE_LABEL: Readonly<Record<Role, NordThemeKey>> = {
  background: 'roleBackground',
  surface: 'roleSurface',
  surfaceRaised: 'roleSurfaceRaised',
  surfaceDeep: 'roleSurfaceDeep',
  text: 'roleText',
  accent: 'roleAccent',
  accentAlt: 'roleAccentAlt',
  danger: 'roleDanger',
  success: 'roleSuccess',
  warning: 'roleWarning',
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  title: 'Nord 配色',
  description: '调整十个基础色和背景图片，其余语义色由基础色派生。改动会立即预览，保存后写入设置。',
  light: '亮色',
  dark: '暗色',
  reset: '恢复默认',
  resetAll: '全部恢复默认',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  readOnly: '本部署的设置为只读。',
  overridden: '已覆盖',
  wallpaperTitle: '背景图片',
  wallpaperDescription: '图片画在界面底色之下，基础表面越透明它越清楚；卡片、菜单等上层表面保持不透明。',
  wallpaperNone: '未选择图片',
  chooseImage: '选择图片',
  removeImage: '移除图片',
  wallpaperOpacity: '图片不透明度',
  opacityUnit: '%',
  wallpaperUploading: '正在保存图片…',
  wallpaperFailed: '图片读取或保存失败，背景仍是上一次的图片。',
  roleBackground: '底色',
  roleSurface: '表面',
  roleSurfaceRaised: '上层表面',
  roleSurfaceDeep: '深层表面',
  roleText: '文字',
  roleAccent: '品牌色',
  roleAccentAlt: '品牌色（悬停）',
  roleDanger: '错误',
  roleSuccess: '成功',
  roleWarning: '警告',
} satisfies Record<string, string>

/** Nord theme dictionary key union. */
export type NordThemeKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  title: 'Nord palette',
  description: 'Ten base colors and a background image drive every derived semantic color. Edits preview immediately and persist on save.',
  light: 'Light',
  dark: 'Dark',
  reset: 'Reset to default',
  resetAll: 'Reset all to defaults',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  readOnly: 'This deployment stores settings read-only.',
  overridden: 'Overridden',
  wallpaperTitle: 'Background image',
  wallpaperDescription: 'The image is painted under the application base, which gives up exactly its opacity; raised surfaces such as cards and menus stay opaque.',
  wallpaperNone: 'No image selected',
  chooseImage: 'Choose image',
  removeImage: 'Remove image',
  wallpaperOpacity: 'Image opacity',
  opacityUnit: '%',
  wallpaperUploading: 'Storing the image…',
  wallpaperFailed: 'The image could not be read or stored; the previous background still stands.',
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
} satisfies Record<NordThemeKey, string>
