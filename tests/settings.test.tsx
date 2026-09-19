// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { DEFAULT_SETTINGS, loadLocal, useSettings } from '../src/lib/settings'
import { loadStoredTheme } from '../src/theme/vscode'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

it('keeps valid saved preferences while replacing invalid values with defaults', () => {
  localStorage.setItem(
    'embegrav.settings',
    JSON.stringify({
      maxCommits: -5,
      order: 'random',
      showStashes: 'false',
      showTags: false,
      diffStyle: 'split',
      dateType: 42,
    }),
  )
  const { result } = renderHook(useSettings)
  expect(result.current[0]).toEqual({ ...DEFAULT_SETTINGS, showTags: false, diffStyle: 'split' })
})

it('uses defaults for malformed settings rather than exposing the stored shape', () => {
  localStorage.setItem('embegrav.settings', '[]')
  const { result } = renderHook(useSettings)
  expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
})

it('validates per-repository state before using it', () => {
  const branches = (value: unknown): value is string[] | null =>
    value === null || (Array.isArray(value) && value.every((branch) => typeof branch === 'string'))
  localStorage.setItem('embegrav.branches:test', JSON.stringify('main'))
  expect(loadLocal('branches:test', null, branches)).toBeNull()
  localStorage.setItem('embegrav.branches:test', JSON.stringify(['main']))
  expect(loadLocal('branches:test', null, branches)).toEqual(['main'])
})

it('ignores malformed persisted themes and preserves a valid imported theme', () => {
  localStorage.setItem('embegrav.theme', '{"colors": []}')
  expect(loadStoredTheme()).toBeNull()
  const theme = { name: 'Theme,]', colors: { 'editor.background': '#fff' } }
  localStorage.setItem('embegrav.theme', JSON.stringify(theme))
  expect(loadStoredTheme()).toEqual(theme)
})
