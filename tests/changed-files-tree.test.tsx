// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChangedFilesTree } from '@/components/ChangedFilesTree'
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider'
import type { ChangedFile } from '@shared/types'
import { createFileMenu } from '@/components/fileMenu'

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

it('opens a file context menu without opening the diff on right click', async () => {
  const open = vi.fn()
  const file: ChangedFile = { path: 'file.txt', status: 'M', additions: 1, deletions: 0 }
  const target = { file, from: 'parent', to: 'commit', label: 'Change' }
  const { container } = render(
    <ThemeProvider>
      <ChangedFilesTree
        files={[file]}
        onOpenFile={() => open(target)}
        menuFor={createFileMenu(
          'R',
          () => target,
          open,
          async () => {},
        )}
      />
    </ThemeProvider>,
  )
  await waitFor(() =>
    expect(treeRoot(container).querySelector('[data-item-path="file.txt"]')).toBeTruthy(),
  )
  fireEvent.contextMenu(treeRoot(container).querySelector('[data-item-path="file.txt"]')!, {
    clientX: 50,
    clientY: 50,
  })
  const view = await screen.findByRole('menuitem', { name: 'View File at this Revision' })
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(view)
  expect(open).toHaveBeenCalledWith({ ...target, view: 'after' })
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

it('moves focus through a file context menu with arrows', async () => {
  const file: ChangedFile = { path: 'file.txt', status: 'M', additions: 1, deletions: 0 }
  const { container } = render(
    <ThemeProvider>
      <ChangedFilesTree
        files={[file]}
        onOpenFile={vi.fn()}
        menuFor={() => [
          { label: 'First action', onClick: vi.fn() },
          { label: 'Second action', onClick: vi.fn() },
        ]}
      />
    </ThemeProvider>,
  )
  await waitFor(() =>
    expect(treeRoot(container).querySelector('[data-item-path="file.txt"]')).toBeTruthy(),
  )
  fireEvent.contextMenu(treeRoot(container).querySelector('[data-item-path="file.txt"]')!)
  const first = (await screen.findByText('First action')).closest('button')!
  const second = screen.getByText('Second action').closest('button')!
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(second)
  fireEvent.keyDown(second, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(second)
  fireEvent.keyDown(second, { key: 'Home' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'End' })
  expect(document.activeElement).toBe(second)
})

it.each(['Enter', ' ', 'Escape', 'Tab'])(
  'handles %j in the file menu without triggering tree or diff shortcuts and restores row focus',
  async (key) => {
    const action = vi.fn()
    const disabledAction = vi.fn()
    const open = vi.fn()
    const primary = vi.fn()
    const shortcut = vi.fn()
    const file: ChangedFile = { path: 'file.txt', status: 'M', additions: 1, deletions: 0 }
    const { container } = render(
      <ThemeProvider>
        <div onKeyDown={shortcut}>
          <ChangedFilesTree
            files={[file]}
            onOpenFile={open}
            rowActions={() => [{ label: 'Stage', icon: null, onClick: primary, primary: true }]}
            menuFor={() => [
              { label: 'Unavailable', disabled: true, onClick: disabledAction },
              'separator',
              { label: 'File action', onClick: action },
            ]}
          />
        </div>
      </ThemeProvider>,
    )
    await waitFor(() =>
      expect(treeRoot(container).querySelector('[data-item-path="file.txt"]')).toBeTruthy(),
    )
    const root = treeRoot(container)
    const row = root.querySelector<HTMLElement>('[data-item-path="file.txt"]')!
    fireEvent.contextMenu(row)
    const disabled = await screen.findByRole('menuitem', { name: 'Unavailable' })
    expect(document.activeElement).toBe(disabled)
    fireEvent.keyDown(disabled, { key: 'Enter' })
    fireEvent.keyDown(disabled, { key: ' ' })
    fireEvent.click(disabled)
    expect(disabledAction).not.toHaveBeenCalled()
    fireEvent.keyDown(disabled, { key: 'ArrowDown' })
    const item = screen.getByRole('menuitem', { name: 'File action' })
    expect(document.activeElement).toBe(item)
    const defaultAllowed = fireEvent.keyDown(item, { key })
    expect(defaultAllowed).toBe(key === 'Tab')
    expect(action).toHaveBeenCalledTimes(key === 'Enter' || key === ' ' ? 1 : 0)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(root.activeElement).toBe(row)
    expect(open).not.toHaveBeenCalled()
    expect(primary).not.toHaveBeenCalled()
    expect(shortcut).not.toHaveBeenCalled()
  },
)

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
