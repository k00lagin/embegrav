/**
 * VS Code theme support.
 *
 * A theme is a plain VS Code colour theme JSON (`colors`, `tokenColors`, ...).
 * `applyTheme()` writes every `colors` entry to a CSS custom property using
 * the same naming VS Code uses for webviews (`editor.background` ->
 * `--vscode-editor-background`), so the stylesheet picks it up directly.
 * The same object is passed to Pierre's diff renderer (Shiki accepts VS Code
 * themes) and to Pierre's file tree.
 */

import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs'

export type ThemeType = 'dark' | 'light' | 'hc' | 'hcLight'

export interface VsCodeTheme {
  name?: string
  type?: ThemeType
  colors?: Record<string, string>
  tokenColors?: unknown[]
  semanticHighlighting?: boolean
  semanticTokenColors?: Record<string, unknown>
  [key: string]: unknown
}

/** Colour keys (with defaults) used by the UI. Dark values = "Dark Modern". */
export const DARK_MODERN_COLORS: Record<string, string> = {
  foreground: '#cccccc',
  descriptionForeground: '#9d9d9d',
  disabledForeground: '#8b8b8b',
  errorForeground: '#f85149',
  focusBorder: '#0078d4',
  'widget.border': '#313131',
  'widget.shadow': '#0000005c',
  'editor.background': '#1f1f1f',
  'editor.foreground': '#cccccc',
  'editor.findMatchBackground': '#9e6a03',
  'editor.findMatchHighlightBackground': '#ea5c0055',
  'editorWidget.background': '#202020',
  'editorWidget.border': '#454545',
  'sideBar.background': '#181818',
  'sideBar.border': '#2b2b2b',
  'sideBarSectionHeader.background': '#181818',
  'sideBarSectionHeader.foreground': '#9d9d9d',
  'sideBarSectionHeader.border': '#2b2b2b',
  'panel.background': '#181818',
  'panel.border': '#2b2b2b',
  'titleBar.activeBackground': '#181818',
  'statusBar.background': '#181818',
  'statusBar.foreground': '#cccccc',
  'statusBar.border': '#2b2b2b',
  'list.hoverBackground': '#2a2d2e',
  'list.activeSelectionBackground': '#04395e',
  'list.activeSelectionForeground': '#ffffff',
  'list.inactiveSelectionBackground': '#37373d',
  'list.focusOutline': '#0078d4',
  'input.background': '#313131',
  'input.foreground': '#cccccc',
  'input.border': '#3c3c3c',
  'input.placeholderForeground': '#989898',
  'dropdown.background': '#313131',
  'dropdown.border': '#3c3c3c',
  'dropdown.foreground': '#cccccc',
  'checkbox.background': '#313131',
  'checkbox.border': '#3c3c3c',
  'button.background': '#0078d4',
  'button.foreground': '#ffffff',
  'button.hoverBackground': '#026ec1',
  'button.secondaryBackground': '#313131',
  'button.secondaryForeground': '#cccccc',
  'button.secondaryHoverBackground': '#3c3c3c',
  'menu.background': '#1f1f1f',
  'menu.foreground': '#cccccc',
  'menu.border': '#454545',
  'menu.selectionBackground': '#0078d4',
  'menu.selectionForeground': '#ffffff',
  'menu.separatorBackground': '#454545',
  'toolbar.hoverBackground': '#5a5d5e50',
  'textLink.foreground': '#4daafc',
  'textLink.activeForeground': '#4daafc',
  'badge.background': '#616161',
  'badge.foreground': '#f8f8f8',
  'notifications.background': '#1f1f1f',
  'notifications.border': '#2b2b2b',
  'notifications.foreground': '#cccccc',
  'notificationsErrorIcon.foreground': '#f14c4c',
  'notificationsWarningIcon.foreground': '#cca700',
  'notificationsInfoIcon.foreground': '#3794ff',
  'progressBar.background': '#0078d4',
  'scrollbarSlider.background': '#79797966',
  'scrollbarSlider.hoverBackground': '#646464b3',
  'gitDecoration.addedResourceForeground': '#81b88b',
  'gitDecoration.modifiedResourceForeground': '#e2c08d',
  'gitDecoration.deletedResourceForeground': '#c74e39',
  'gitDecoration.renamedResourceForeground': '#73c991',
  'gitDecoration.untrackedResourceForeground': '#73c991',
  'gitDecoration.conflictingResourceForeground': '#e4676b',
  'gitDecoration.ignoredResourceForeground': '#8c8c8c',
  'charts.red': '#f14c4c',
  'charts.blue': '#3794ff',
  'charts.yellow': '#cca700',
  'charts.orange': '#d18616',
  'charts.green': '#89d185',
  'charts.purple': '#b180d7',
  'terminal.ansiRed': '#cd3131',
  'terminal.ansiGreen': '#0dbc79',
  'terminal.ansiYellow': '#e5e510',
  'terminal.ansiBlue': '#2472c8',
  'terminal.ansiMagenta': '#bc3fbc',
  'terminal.ansiCyan': '#11a8cd',
  'terminal.ansiBrightRed': '#f14c4c',
  'terminal.ansiBrightGreen': '#23d18b',
  'terminal.ansiBrightYellow': '#f5f543',
  'terminal.ansiBrightBlue': '#3b8eea',
  'terminal.ansiBrightMagenta': '#d670d6',
  'terminal.ansiBrightCyan': '#29b8db',
}

/** "Light Modern" values for the same keys. */
export const LIGHT_MODERN_COLORS: Record<string, string> = {
  foreground: '#3b3b3b',
  descriptionForeground: '#3b3b3b',
  disabledForeground: '#a0a0a0',
  errorForeground: '#f85149',
  focusBorder: '#005fb8',
  'widget.border': '#e5e5e5',
  'widget.shadow': '#00000029',
  'editor.background': '#ffffff',
  'editor.foreground': '#3b3b3b',
  'editor.findMatchBackground': '#a8ac94',
  'editor.findMatchHighlightBackground': '#ea5c0055',
  'editorWidget.background': '#f8f8f8',
  'editorWidget.border': '#c8c8c8',
  'sideBar.background': '#f8f8f8',
  'sideBar.border': '#e5e5e5',
  'sideBarSectionHeader.background': '#f8f8f8',
  'sideBarSectionHeader.foreground': '#3b3b3b',
  'sideBarSectionHeader.border': '#e5e5e5',
  'panel.background': '#f8f8f8',
  'panel.border': '#e5e5e5',
  'titleBar.activeBackground': '#f8f8f8',
  'statusBar.background': '#f8f8f8',
  'statusBar.foreground': '#3b3b3b',
  'statusBar.border': '#e5e5e5',
  'list.hoverBackground': '#f2f2f2',
  'list.activeSelectionBackground': '#e8e8e8',
  'list.activeSelectionForeground': '#000000',
  'list.inactiveSelectionBackground': '#e4e6f1',
  'list.focusOutline': '#005fb8',
  'input.background': '#ffffff',
  'input.foreground': '#3b3b3b',
  'input.border': '#cecece',
  'input.placeholderForeground': '#767676',
  'dropdown.background': '#ffffff',
  'dropdown.border': '#cecece',
  'dropdown.foreground': '#3b3b3b',
  'checkbox.background': '#f8f8f8',
  'checkbox.border': '#cecece',
  'button.background': '#005fb8',
  'button.foreground': '#ffffff',
  'button.hoverBackground': '#0258a8',
  'button.secondaryBackground': '#e5e5e5',
  'button.secondaryForeground': '#3b3b3b',
  'button.secondaryHoverBackground': '#cccccc',
  'menu.background': '#ffffff',
  'menu.foreground': '#3b3b3b',
  'menu.border': '#cecece',
  'menu.selectionBackground': '#005fb8',
  'menu.selectionForeground': '#ffffff',
  'menu.separatorBackground': '#d4d4d4',
  'toolbar.hoverBackground': '#b8b8b850',
  'textLink.foreground': '#005fb8',
  'textLink.activeForeground': '#005fb8',
  'badge.background': '#cccccc',
  'badge.foreground': '#3b3b3b',
  'notifications.background': '#ffffff',
  'notifications.border': '#e5e5e5',
  'notifications.foreground': '#3b3b3b',
  'notificationsErrorIcon.foreground': '#e51400',
  'notificationsWarningIcon.foreground': '#bf8803',
  'notificationsInfoIcon.foreground': '#1a85ff',
  'progressBar.background': '#005fb8',
  'scrollbarSlider.background': '#64646466',
  'scrollbarSlider.hoverBackground': '#646464b3',
  'gitDecoration.addedResourceForeground': '#587c0c',
  'gitDecoration.modifiedResourceForeground': '#895503',
  'gitDecoration.deletedResourceForeground': '#ad0707',
  'gitDecoration.renamedResourceForeground': '#007100',
  'gitDecoration.untrackedResourceForeground': '#007100',
  'gitDecoration.conflictingResourceForeground': '#ad0707',
  'gitDecoration.ignoredResourceForeground': '#8e8e90',
  'charts.red': '#e51400',
  'charts.blue': '#1a85ff',
  'charts.yellow': '#bf8803',
  'charts.orange': '#d18616',
  'charts.green': '#388a34',
  'charts.purple': '#652d90',
  'terminal.ansiRed': '#cd3131',
  'terminal.ansiGreen': '#107c10',
  'terminal.ansiYellow': '#949800',
  'terminal.ansiBlue': '#0451a5',
  'terminal.ansiMagenta': '#bc05bc',
  'terminal.ansiCyan': '#0598bc',
  'terminal.ansiBrightRed': '#cd3131',
  'terminal.ansiBrightGreen': '#14ce14',
  'terminal.ansiBrightYellow': '#b5ba00',
  'terminal.ansiBrightBlue': '#0451a5',
  'terminal.ansiBrightMagenta': '#bc05bc',
  'terminal.ansiBrightCyan': '#0598bc',
}

/**
 * Theme colour keys used for graph lanes, in assignment order. Every VS Code
 * theme defines the terminal ANSI palette, so lanes follow the theme.
 */
export const GRAPH_COLOR_KEYS = [
  'terminal.ansiBlue',
  'terminal.ansiMagenta',
  'terminal.ansiGreen',
  'terminal.ansiYellow',
  'terminal.ansiCyan',
  'terminal.ansiRed',
  'terminal.ansiBrightBlue',
  'terminal.ansiBrightMagenta',
  'terminal.ansiBrightGreen',
  'terminal.ansiBrightYellow',
  'terminal.ansiBrightCyan',
  'terminal.ansiBrightRed',
]

/** Lane colours for a theme (falls back to the matching default palette). */
export function graphColorsFor(theme: VsCodeTheme): string[] {
  const colors = resolveColors(theme)
  const fallback = isLightTheme(theme) ? LIGHT_MODERN_COLORS : DARK_MODERN_COLORS
  return GRAPH_COLOR_KEYS.map((key) => colors[key] ?? fallback[key])
}

export const DEFAULT_DARK_THEME: VsCodeTheme = {
  name: 'Dark Modern',
  type: 'dark',
  colors: DARK_MODERN_COLORS,
}
export const DEFAULT_LIGHT_THEME: VsCodeTheme = {
  name: 'Light Modern',
  type: 'light',
  colors: LIGHT_MODERN_COLORS,
}

export function themeCssVar(key: string): string {
  return `--vscode-${key.replace(/\./g, '-')}`
}

export function isLightTheme(theme: VsCodeTheme): boolean {
  if (theme.type === 'light' || theme.type === 'hcLight') return true
  if (theme.type === 'dark' || theme.type === 'hc') return false
  // Guess from the editor background luminance
  const bg = theme.colors?.['editor.background']
  return bg ? luminance(bg) > 0.5 : false
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  if (!m) return 0
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function rgb(hex: string): number[] | null {
  if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null
  const full = hex.length <= 5 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}

/** Concrete hex colors are also consumed by Shiki/Pierre, not just CSS. */
function mix(background: string, foreground: string, amount: number): string {
  const bg = rgb(background)
  const fg = rgb(foreground)
  if (!bg || !fg) return background
  return (
    '#' +
    bg
      .map((channel, i) =>
        Math.round(channel + (fg[i] - channel) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

function contrastingText(background: string): string {
  const channels = (rgb(background) ?? [0, 0, 0]).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const relativeLuminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return relativeLuminance > 0.179 ? '#000000' : '#ffffff'
}

/** Full colour map with related theme colours preferred over built-in fallbacks. */
export function resolveColors(theme: VsCodeTheme): Record<string, string> {
  const base = isLightTheme(theme) ? LIGHT_MODERN_COLORS : DARK_MODERN_COLORS
  const own = theme.colors ?? {}
  const colors = { ...base, ...own }
  const set = (key: string, fallback: string) => {
    colors[key] = own[key] ?? fallback
  }
  // Prefer explicit related tokens before falling back to a resolved parent.
  const inherit = (key: string, ...parents: string[]) => {
    set(
      key,
      parents.map((parent) => own[parent]).find((value) => value !== undefined) ??
        colors[parents[0]],
    )
  }

  inherit('foreground', 'editor.foreground')
  inherit('editor.foreground', 'foreground')
  set('descriptionForeground', mix(colors['editor.background'], colors.foreground, 0.75))
  set('disabledForeground', mix(colors['editor.background'], colors.foreground, 0.5))
  inherit('sideBar.background', 'editor.background')
  inherit('sideBar.foreground', 'foreground')
  inherit('panel.background', 'sideBar.background', 'editor.background')
  set(
    'widget.border',
    own['contrastBorder'] ??
      own['panel.border'] ??
      own['sideBar.border'] ??
      own['input.border'] ??
      mix(colors['sideBar.background'], colors.foreground, 0.25),
  )
  inherit('panel.border', 'widget.border', 'sideBar.border')
  inherit('sideBar.border', 'panel.border', 'widget.border')
  inherit('editorWidget.background', 'sideBar.background', 'editor.background')
  inherit('editorWidget.foreground', 'foreground', 'editor.foreground')
  inherit('editorWidget.border', 'widget.border', 'panel.border', 'input.border')
  inherit('sideBarSectionHeader.background', 'sideBar.background', 'editor.background')
  inherit('sideBarSectionHeader.foreground', 'sideBar.foreground', 'foreground')
  inherit('sideBarSectionHeader.border', 'sideBar.border', 'panel.border')
  inherit('titleBar.activeBackground', 'sideBar.background', 'editor.background')
  inherit('statusBar.background', 'sideBar.background', 'editor.background')
  inherit('statusBar.foreground', 'foreground')
  inherit('statusBar.border', 'panel.border')

  set('list.hoverBackground', mix(colors['editor.background'], colors.foreground, 0.12))
  set(
    'list.activeSelectionBackground',
    own['list.inactiveSelectionBackground'] ??
      mix(colors['editor.background'], colors.foreground, 0.25),
  )
  inherit('list.activeSelectionForeground', 'foreground')
  set('list.inactiveSelectionBackground', mix(colors['editor.background'], colors.foreground, 0.18))
  set(
    'focusBorder',
    own['list.focusOutline'] ??
      own['button.background'] ??
      own['textLink.foreground'] ??
      colors.foreground,
  )
  inherit('list.focusOutline', 'focusBorder')
  inherit('textLink.foreground', 'focusBorder')
  inherit('textLink.activeForeground', 'textLink.foreground')
  inherit('toolbar.hoverBackground', 'list.hoverBackground')

  inherit('input.background', 'editor.background', 'dropdown.background')
  inherit('input.foreground', 'foreground', 'editor.foreground')
  inherit('input.border', 'widget.border', 'dropdown.border', 'panel.border')
  inherit('input.placeholderForeground', 'descriptionForeground')
  inherit('dropdown.background', 'input.background', 'editorWidget.background', 'editor.background')
  inherit('dropdown.foreground', 'input.foreground', 'foreground')
  inherit('dropdown.border', 'input.border', 'widget.border')
  inherit('checkbox.background', 'input.background', 'dropdown.background')
  inherit('checkbox.foreground', 'input.foreground', 'foreground')
  inherit('checkbox.border', 'input.border', 'dropdown.border')

  inherit(
    'button.background',
    'list.activeSelectionBackground',
    'focusBorder',
    'textLink.foreground',
  )
  set(
    'button.foreground',
    !own['button.background'] &&
      colors['button.background'] === colors['list.activeSelectionBackground']
      ? colors['list.activeSelectionForeground']
      : contrastingText(colors['button.background']),
  )
  set(
    'button.hoverBackground',
    mix(colors['button.background'], contrastingText(colors['button.background']), 0.12),
  )
  inherit(
    'button.secondaryBackground',
    'input.background',
    'dropdown.background',
    'editorWidget.background',
  )
  inherit('button.secondaryForeground', 'input.foreground', 'foreground')
  set(
    'button.secondaryHoverBackground',
    mix(colors['button.secondaryBackground'], colors['button.secondaryForeground'], 0.12),
  )

  inherit(
    'menu.background',
    'dropdown.background',
    'editorWidget.background',
    'sideBar.background',
    'editor.background',
  )
  inherit('menu.foreground', 'dropdown.foreground', 'foreground')
  inherit('menu.border', 'dropdown.border', 'editorWidget.border', 'widget.border')
  inherit('menu.selectionBackground', 'list.activeSelectionBackground')
  inherit('menu.selectionForeground', 'list.activeSelectionForeground')
  inherit('menu.separatorBackground', 'menu.border', 'dropdown.border', 'panel.border')
  inherit(
    'notifications.background',
    'editorWidget.background',
    'sideBar.background',
    'editor.background',
  )
  inherit('notifications.foreground', 'editorWidget.foreground', 'foreground')
  inherit('notifications.border', 'editorWidget.border', 'panel.border')
  inherit('notificationsErrorIcon.foreground', 'errorForeground')
  inherit('notificationsWarningIcon.foreground', 'gitDecoration.modifiedResourceForeground')
  inherit('notificationsInfoIcon.foreground', 'textLink.foreground', 'focusBorder')
  inherit('progressBar.background', 'focusBorder', 'button.background')
  inherit('badge.background', 'list.activeSelectionBackground')
  inherit('badge.foreground', 'list.activeSelectionForeground')
  set('scrollbarSlider.background', mix(colors['editor.background'], colors.foreground, 0.25))
  set('scrollbarSlider.hoverBackground', mix(colors['editor.background'], colors.foreground, 0.4))
  return colors
}

let appliedKeys = new Set<string>()

export function applyTheme(theme: VsCodeTheme): void {
  const root = document.documentElement
  const colors = resolveColors(theme)
  for (const key of appliedKeys) {
    if (!(key in colors)) root.style.removeProperty(themeCssVar(key))
  }
  appliedKeys = new Set(Object.keys(colors))
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') root.style.setProperty(themeCssVar(key), value)
  }
  root.style.setProperty(
    '--embegrav-danger-foreground',
    contrastingText(colors['gitDecoration.deletedResourceForeground']),
  )
  root.dataset.themeType = theme.type ?? (isLightTheme(theme) ? 'light' : 'dark')
}

/** Parse VS Code theme JSON, tolerating comments and trailing commas (JSONC). */
export function parseThemeJson(text: string): VsCodeTheme {
  const stripped = stripJsonComments(text)
  const parsed = JSON.parse(stripped) as unknown
  if (!isRecord(parsed)) throw new Error('Theme file must be a JSON object')
  if (!isRecord(parsed.colors)) {
    throw new Error('Theme file has no "colors" section')
  }
  if (Object.values(parsed.colors).some((value) => typeof value !== 'string')) {
    throw new Error('Theme colors must be strings')
  }
  if (parsed.name !== undefined && typeof parsed.name !== 'string') {
    throw new Error('Theme name must be a string')
  }
  if (
    parsed.type !== undefined &&
    (typeof parsed.type !== 'string' || !['dark', 'light', 'hc', 'hcLight'].includes(parsed.type))
  ) {
    throw new Error('Invalid theme type')
  }
  if (parsed.tokenColors !== undefined && !Array.isArray(parsed.tokenColors)) {
    throw new Error('Theme tokenColors must be an array')
  }
  return parsed as VsCodeTheme
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      if (i === text.length) throw new Error('Unterminated theme comment')
      i++
      out += ' '
    } else if (ch === '}' || ch === ']') {
      // Only outside strings, after comments have been removed.
      out = out.replace(/,\s*$/, '') + ch
    } else {
      out += ch
    }
  }
  return out
}

const STORAGE_KEY = 'embegrav.theme'

export function loadStoredTheme(): VsCodeTheme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseThemeJson(raw)
  } catch {
    return null
  }
}

export function storeTheme(theme: VsCodeTheme | null): void {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, JSON.stringify(theme))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore quota errors */
  }
}

const registeredThemes = new WeakMap<VsCodeTheme, string>()
let themeCounter = 0

/**
 * Name of the Shiki theme Pierre diffs should use. A VS Code theme that has
 * token colours is registered with Pierre's highlighter as a custom theme, so
 * diffs are highlighted exactly like the editor would. Themes without token
 * colours fall back to Pierre's built-in light/dark theme.
 */
export function shikiThemeFor(theme: VsCodeTheme): string {
  if (!Array.isArray(theme.tokenColors) || theme.tokenColors.length === 0) {
    return isLightTheme(theme) ? 'pierre-light' : 'pierre-dark'
  }
  let name = registeredThemes.get(theme)
  if (!name) {
    name = `vscode-theme-${++themeCounter}`
    const registration = {
      ...theme,
      name,
      type: isLightTheme(theme) ? 'light' : 'dark',
      colors: resolveColors(theme),
    } as ThemeRegistration
    registerCustomTheme(name, () => Promise.resolve(registration))
    registeredThemes.set(theme, name)
  }
  return name
}
