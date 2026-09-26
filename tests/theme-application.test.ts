// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { applyTheme, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../src/theme/vscode'

afterEach(() => applyTheme(DEFAULT_DARK_THEME))

it('replaces derived control colors and clears optional tokens when switching themes', () => {
  applyTheme({
    type: 'dark',
    colors: {
      'editor.background': '#002451',
      'editor.foreground': '#bbdaff',
      'dropdown.background': '#001733',
      'checkbox.selectBackground': '#123456',
      'checkbox.selectBorder': '#abcdef',
      'button.border': '#fedcba',
    },
  })
  const root = document.documentElement
  expect(root.style.getPropertyValue('--vscode-menu-background')).toBe('#001733')
  expect(root.style.getPropertyValue('--vscode-checkbox-selectBackground')).toBe('#123456')
  expect(root.dataset.themeType).toBe('dark')

  applyTheme(DEFAULT_LIGHT_THEME)
  expect(root.style.getPropertyValue('--vscode-menu-background')).toBe('#ffffff')
  expect(root.style.getPropertyValue('--vscode-checkbox-background')).toBe('#f8f8f8')
  expect(root.style.getPropertyValue('--vscode-checkbox-selectBackground')).toBe('')
  expect(root.style.getPropertyValue('--vscode-checkbox-selectBorder')).toBe('')
  expect(root.style.getPropertyValue('--vscode-button-border')).toBe('')
  expect(root.dataset.themeType).toBe('light')
})
