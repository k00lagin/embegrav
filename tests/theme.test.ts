import { describe, expect, it } from 'vitest'
import { parseThemeJson } from '../src/theme/vscode'

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
