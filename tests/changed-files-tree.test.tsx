// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChangedFilesTree } from '@/components/ChangedFilesTree'
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider'
import type { ChangedFile } from '@shared/types'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function ThemeSwitch() {
  const { setTheme } = useTheme()
  return (
    <button
      onClick={() =>
        setTheme({
          name: 'Test colors',
          type: 'light',
          colors: {
            'gitDecoration.addedResourceForeground': '#123456',
            'gitDecoration.deletedResourceForeground': '#654321',
          },
        })
      }
    >
      Switch theme
    </button>
  )
}
function treeRoot(container: HTMLElement) {
  const host = container.querySelector('file-tree-container')
  if (!host?.shadowRoot) throw new Error('Tree has not mounted')
  return host.shadowRoot
}

it('opens a newly staged file and uses current counts, status, and theme after updates', async () => {
  const open = vi.fn()
  const view = (files: ChangedFile[]) => (
    <ThemeProvider>
      <ThemeSwitch />
      <ChangedFilesTree files={files} onOpenFile={open} />
    </ThemeProvider>
  )
  const { container, rerender } = render(view([]))
  expect(screen.getByText('No changes')).toBeTruthy()
  const first: ChangedFile = { path: 'new.txt', status: 'A', additions: 1, deletions: 0 }
  rerender(view([first]))
  await waitFor(() => expect(treeRoot(container).textContent).toContain('+1'))
  const root = treeRoot(container)
  const row = root.querySelector('[data-item-path="new.txt"]')
  if (!row) throw new Error('Missing file row')
  fireEvent.click(row)
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(first))
  const updated: ChangedFile = { ...first, status: 'M', additions: 7, deletions: 2 }
  rerender(view([updated]))
  await waitFor(() => expect(root.textContent).toContain('+7'))
  rerender(view([updated, { ...first, path: 'other.txt' }]))
  const other = root.querySelector('[data-item-path="other.txt"]')!
  fireEvent.click(other)
  const updatedRow = root.querySelector('[data-item-path="new.txt"]')!
  expect(updatedRow.getAttribute('data-item-git-status')).toBe('modified')
  fireEvent.click(updatedRow)
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(updated))
  fireEvent.click(screen.getByRole('button', { name: 'Switch theme' }))
  await waitFor(() => expect(root.innerHTML).toContain('rgb(18, 52, 86)'))
})
