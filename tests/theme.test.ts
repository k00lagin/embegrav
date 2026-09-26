import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  parseThemeJson,
  resolveColors,
  type VsCodeTheme,
} from '../src/theme/vscode'

describe('imported theme controls', () => {
  it.each([
    {
      type: 'dark',
      background: '#002451',
      surface: '#001c40',
      input: '#001733',
      foreground: '#bbdaff',
      selection: '#5f738a',
    },
    {
      type: 'light',
      background: '#fdf6e3',
      surface: '#eee8d5',
      input: '#e5ddc5',
      foreground: '#586e75',
      selection: '#dfcd88',
    },
  ] as const)('keeps omitted control colors in the $type palette', (palette) => {
    const colors = resolveColors({
      type: palette.type,
      colors: {
        'editor.background': palette.background,
        'editor.foreground': palette.foreground,
        'sideBar.background': palette.surface,
        'dropdown.background': palette.input,
        'input.background': palette.input,
        'input.border': palette.foreground,
        'list.activeSelectionBackground': palette.selection,
        'list.activeSelectionForeground': palette.foreground,
      },
    })
    expect(colors['menu.background']).toBe(palette.input)
    expect(colors['menu.foreground']).toBe(palette.foreground)
    expect(colors['menu.selectionBackground']).toBe(palette.selection)
    expect(colors['menu.selectionForeground']).toBe(palette.foreground)
    expect(colors['editorWidget.background']).toBe(palette.surface)
    expect(colors['editorWidget.foreground']).toBe(palette.foreground)
    expect(colors['checkbox.background']).toBe(palette.input)
    expect(colors['checkbox.foreground']).toBe(palette.foreground)
    expect(colors['checkbox.border']).toBe(palette.foreground)
    expect(colors['button.background']).toBe(palette.selection)
    expect(colors['button.foreground']).toBe(palette.foreground)
    expect(colors['button.secondaryBackground']).toBe(palette.input)
    expect(colors['button.secondaryForeground']).toBe(palette.foreground)
    expect(colors['notifications.background']).toBe(palette.surface)
    expect(colors['notifications.foreground']).toBe(palette.foreground)
    expect(colors['button.hoverBackground']).not.toBe(colors['button.background'])
    expect(colors['button.secondaryHoverBackground']).not.toBe(colors['button.secondaryBackground'])
  })

  it('preserves every explicitly supplied token, including transparent states', () => {
    const own = {
      ...DEFAULT_DARK_THEME.colors,
      'checkbox.foreground': '#123456',
      'checkbox.selectBackground': '#abcdef',
      'checkbox.selectBorder': '#987654',
      'editorWidget.foreground': '#fedcba',
      'menu.selectionBackground': '#00000000',
      'button.hoverBackground': '#ffffff22',
    }
    expect(resolveColors({ colors: own })).toMatchObject(own)
  })

  it.each(['#eeeeee', '#111111'])(
    'keeps text legible on a custom button background %s',
    (background) => {
      const colors = resolveColors({ colors: { 'button.background': background } })
      expect(colors['button.foreground']).toBe(background === '#eeeeee' ? '#000000' : '#ffffff')
      expect(colors['button.hoverBackground']).not.toBe(background)
    },
  )

  it.each(['dark', 'light', 'hc', 'hcLight'] as const)(
    'resolves sparse %s themes to concrete colors',
    (type) => {
      const theme: VsCodeTheme = {
        type,
        colors: { 'editor.background': '#123456', 'editor.foreground': '#abcdef' },
      }
      const colors = resolveColors(theme)
      for (const key of [
        'input.background',
        'dropdown.background',
        'menu.background',
        'editorWidget.background',
        'notifications.background',
      ]) {
        expect(colors[key]).toBe('#123456')
      }
      // The same map is passed to Shiki/Pierre, so derived colors must be hex, not CSS expressions.
      for (const value of Object.values(colors))
        expect(value).toMatch(/^#[\da-f]{6}([\da-f]{2})?$/i)
    },
  )
})

describe('imported theme headers', () => {
  it.each([
    { type: 'dark', background: '#001c40', foreground: '#b8d5f5', border: '#304860' },
    { type: 'light', background: '#eee8d5', foreground: '#586e75', border: '#d6ceb5' },
  ])(
    'inherits omitted header colors from the $type theme',
    ({ type, background, foreground, border }) => {
      const colors = resolveColors(
        parseThemeJson(
          JSON.stringify({
            type,
            colors: {
              'sideBar.background': background,
              'sideBar.foreground': foreground,
              'sideBar.border': border,
            },
          }),
        ),
      )
      expect(colors['sideBarSectionHeader.background']).toBe(background)
      expect(colors['sideBarSectionHeader.foreground']).toBe(foreground)
      expect(colors['sideBarSectionHeader.border']).toBe(border)
    },
  )

  it('uses editor and panel colors when sidebar colors are also omitted', () => {
    const colors = resolveColors({
      colors: {
        'editor.background': '#002451',
        foreground: '#b8d5f5',
        'panel.border': '#304860',
      },
    })
    expect(colors['sideBarSectionHeader.background']).toBe('#002451')
    expect(colors['sideBarSectionHeader.foreground']).toBe('#b8d5f5')
    expect(colors['sideBarSectionHeader.border']).toBe('#304860')
  })

  it('preserves explicit header colors, including transparency', () => {
    const headers = {
      'sideBarSectionHeader.background': '#12345680',
      'sideBarSectionHeader.foreground': '#abcdef',
      'sideBarSectionHeader.border': '#00000000',
    }
    expect(
      resolveColors({ colors: { 'sideBar.background': '#001c40', ...headers } }),
    ).toMatchObject(headers)
  })

  it.each([DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME])(
    'preserves the built-in $name palette',
    (theme) => {
      expect(resolveColors(theme)).toMatchObject(theme.colors!)
      expect(resolveColors(theme)['sideBarSectionHeader.foreground']).toBe(
        theme.colors!.descriptionForeground,
      )
    },
  )
})

describe('theme JSONC import', () => {
  it('preserves punctuation, escaped quotes, and comment-like text inside strings', () => {
    const theme = {
      name: 'Theme,] ,} "quoted" // not a comment /* neither */',
      colors: { 'editor.background': '#ffffff' },
      tokenColors: [{ scope: 'literal,]', settings: { foreground: '#abcdef' } }],
    }
    expect(parseThemeJson(JSON.stringify(theme))).toEqual(theme)
  })

  it('accepts comments between trailing commas and closing brackets', () => {
    expect(
      parseThemeJson(`{
      // An imported VS Code theme
      "name": "Example",
      "colors": { "editor.background": "#ffffff", /* trailing */ },
      "tokenColors": [ { "scope": "string", "settings": {}, }, // trailing
      ],
    }`),
    ).toEqual({
      name: 'Example',
      colors: { 'editor.background': '#ffffff' },
      tokenColors: [{ scope: 'string', settings: {} }],
    })
  })

  it.each([
    '[]',
    'null',
    '{"colors": []}',
    '{"colors": {"editor.background": false}}',
    '{"colors": {}, "name": 42}',
    '{"colors": {}, "type": "invalid"}',
    '{"colors": {}, "tokenColors": {}}',
  ])('rejects an invalid theme shape: %s', (text) => {
    expect(() => parseThemeJson(text)).toThrow()
  })
})
