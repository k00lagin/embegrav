// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { DiffViewer, type DiffTarget } from '@/components/DiffViewer'
import { createFileMenu, withWorkingFile } from '@/components/fileMenu'
import type { MenuEntry, MenuItem } from '@/components/ContextMenu'
import { ToastProvider } from '@/components/Toast'
import { ThemeProvider } from '@/theme/ThemeProvider'

// Verify which complete file reaches Pierre, without depending on its syntax-highlighting worker.
vi.mock('@pierre/diffs/react', () => ({
  File: ({
    file,
    options,
  }: {
    file: { name: string; contents: string }
    options: { overflow: string }
  }) => (
    <pre data-testid="full-file" data-name={file.name} data-overflow={options.overflow}>
      {file.contents}
    </pre>
  ),
  PatchDiff: ({ patch }: { patch: string }) => <pre data-testid="patch">{patch}</pre>,
}))

const target: DiffTarget = {
  file: { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'R', additions: 1, deletions: 1 },
  from: 'parent',
  to: 'commit',
  label: 'parent → commit',
}
function View({
  value = target,
  onClose = () => {},
}: {
  value?: DiffTarget
  onClose?: () => void
}) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DiffViewer
          repo="R"
          target={value}
          diffStyle="unified"
          onDiffStyleChange={() => {}}
          onClose={onClose}
        />
      </ToastProvider>
    </ThemeProvider>
  )
}
beforeEach(() => {
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
  Element.prototype.scrollIntoView = () => {}
  vi.spyOn(api, 'fileDiff').mockResolvedValue({ patch: 'patch', binary: false })
  vi.spyOn(api, 'fileContent').mockImplementation(async (_repo, rev, path) => ({
    contents: `${rev}: ${path}\nunchanged lines\nlast line`,
  }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const other: DiffTarget = {
  file: { path: 'src/other.ts', status: 'M', additions: 2, deletions: 1 },
  from: 'parent',
  to: 'commit',
  label: 'parent → commit',
}
const deletedSibling: DiffTarget = {
  ...other,
  file: { ...other.file, path: 'src/deleted.ts', status: 'D' },
}
const siblings = [target, other, deletedSibling]

it('filters the path menu and switches files while preserving the full-file mode', async () => {
  const close = vi.fn()
  render(<View value={{ ...target, siblings, view: 'working' }} onClose={close} />)
  await screen.findByTestId('full-file')
  fireEvent.click(screen.getByRole('button', { name: 'Switch file (src/new.ts)' }))
  const search = screen.getByRole('textbox', { name: 'Search files' })
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox', { name: 'Search files' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Switch file (src/new.ts)' }))
  const input = screen.getByRole('textbox', { name: 'Search files' })
  fireEvent.change(input, { target: { value: ' OTHER ' } })
  expect(screen.queryByRole('button', { name: /src\/new\.ts\s*R/ })).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() =>
    expect(screen.getByTestId('full-file').textContent).toContain('WORKING: src/other.ts'),
  )
  expect(screen.getByRole('combobox', { name: 'File view' })).toHaveProperty('value', 'working')
})

it('synchronizes sidebar selection with file navigation and keeps the sidebar open', async () => {
  const { container } = render(<View value={{ ...target, siblings }} />)
  await screen.findByTestId('patch')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle files sidebar' }))
  const root = () => container.querySelector('file-tree-container')!.shadowRoot!
  await waitFor(() =>
    expect(
      root().querySelector('[data-item-path="src/new.ts"]')?.hasAttribute('data-item-selected'),
    ).toBe(true),
  )
  fireEvent.click(root().querySelector('[data-item-path="src/other.ts"]')!)
  await waitFor(() =>
    expect(api.fileDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'src/other.ts', from: 'parent', to: 'commit' }),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Switch file (src/other.ts)' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /src\/new\.ts\s*R/ }))
  await waitFor(() =>
    expect(
      root().querySelector('[data-item-path="src/new.ts"]')?.hasAttribute('data-item-selected'),
    ).toBe(true),
  )
  expect(
    root().querySelector('[data-item-path="src/other.ts"]')?.hasAttribute('data-item-selected'),
  ).toBe(false)
  expect(screen.getByRole('complementary', { name: 'Files in current change' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Toggle files sidebar' }))
  expect(screen.queryByRole('complementary')).toBeNull()
})

it('uses the previous version for deleted files and preserves comparisons with working files', async () => {
  const { rerender } = render(<View value={{ ...target, siblings, view: 'after' }} />)
  await screen.findByTestId('full-file')
  fireEvent.click(screen.getByRole('button', { name: 'Switch file (src/new.ts)' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /src\/deleted\.ts\s*D/ }))
  await waitFor(() =>
    expect(api.fileContent).toHaveBeenLastCalledWith('R', 'parent', 'src/deleted.ts'),
  )
  expect(screen.getByRole('combobox', { name: 'File view' })).toHaveProperty('value', 'before')
  rerender(<View value={withWorkingFile({ ...target, siblings })} />)
  await screen.findByTestId('patch')
  fireEvent.click(screen.getByRole('button', { name: 'Switch file (src/new.ts)' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /src\/other\.ts\s*M/ }))
  await waitFor(() =>
    expect(api.fileDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'src/other.ts', from: 'commit', to: 'WORKING' }),
    ),
  )
})

it('switches between diff and complete before, after and working files, including renames', async () => {
  render(<View />)
  await screen.findByTestId('patch')
  const mode = screen.getByRole('combobox', { name: 'File view' })
  fireEvent.change(mode, { target: { value: 'before' } })
  expect((await screen.findByTestId('full-file')).textContent).toContain(
    'parent: src/old.ts\nunchanged lines\nlast line',
  )
  expect(screen.queryByRole('button', { name: 'Split view' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Toggle line wrapping' }))
  expect(screen.getByTestId('full-file').getAttribute('data-overflow')).toBe('wrap')
  fireEvent.change(mode, { target: { value: 'after' } })
  await waitFor(() =>
    expect(screen.getByTestId('full-file').textContent).toContain('commit: src/new.ts'),
  )
  fireEvent.change(mode, { target: { value: 'working' } })
  await waitFor(() =>
    expect(screen.getByTestId('full-file').textContent).toContain('WORKING: src/new.ts'),
  )
  fireEvent.change(mode, { target: { value: 'diff' } })
  await screen.findByTestId('patch')
  expect(screen.queryByTestId('full-file')).toBeNull()
})

it('ignores a file response arriving after switching to another revision', async () => {
  let finish!: (value: { contents: string }) => void
  vi.mocked(api.fileContent).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  render(<View value={{ ...target, view: 'before' }} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'File view' }), {
    target: { value: 'after' },
  })
  await screen.findByTestId('full-file')
  await act(async () => finish({ contents: 'obsolete response' }))
  expect(screen.getByTestId('full-file').textContent).toContain('commit: src/new.ts')
})

it('retries full-file errors in the panel and handles empty and unavailable contents', async () => {
  vi.mocked(api.fileContent)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ contents: '' })
    .mockResolvedValue({ contents: null })
  render(<View value={{ ...target, view: 'after' }} />)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Could not load file')
  expect(alert.textContent).toContain('File: src/new.ts')
  expect(alert.textContent).toContain('Revision: commit')
  expect(alert.closest('[aria-busy]')).not.toBeNull()
  expect(screen.queryByText('Loading file…')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Empty file.')
  fireEvent.change(screen.getByRole('combobox', { name: 'File view' }), {
    target: { value: 'working' },
  })
  await screen.findByText('File contents are not available (binary or missing).')
  expect(api.fileDiff).not.toHaveBeenCalled()
})

function entry(items: MenuEntry[], label: string): MenuItem {
  const item = items.find((i): i is MenuItem => i !== 'separator' && i.label === label)
  if (!item) throw new Error(`Missing menu item: ${label}`)
  return item
}

it('compares the selected revision at its current path, and copies native absolute and relative paths', () => {
  const open = vi.fn()
  const copy = vi.fn(async () => {})
  const menu = createFileMenu(
    'C:\\repo\\',
    () => target,
    open,
    copy,
  )(target.file, target.file.path, false)
  entry(menu, 'View Diff with Working File').onClick()
  expect(open).toHaveBeenLastCalledWith(
    expect.objectContaining({
      from: 'commit',
      to: 'WORKING',
      file: expect.objectContaining({ path: 'src/new.ts', oldPath: undefined, status: 'M' }),
    }),
  )
  entry(menu, 'View File at this Revision').onClick()
  expect(open).toHaveBeenLastCalledWith({ ...target, view: 'after' })
  entry(menu, 'Open Working File').onClick()
  expect(open).toHaveBeenLastCalledWith({ ...target, view: 'working' })
  entry(menu, 'Copy Absolute File Path').onClick()
  expect(copy).toHaveBeenLastCalledWith('C:\\repo\\src\\new.ts', 'Absolute path')
  entry(menu, 'Copy Relative File Path').onClick()
  expect(copy).toHaveBeenLastCalledWith('src/new.ts', 'Relative path')
})

it('opens deleted files before deletion and keeps stage actions and folder path menus', () => {
  const open = vi.fn()
  const copy = vi.fn(async () => {})
  const deleted: DiffTarget = { ...target, file: { ...target.file, status: 'D' } }
  const menuFor = createFileMenu(
    '/repo',
    () => deleted,
    open,
    copy,
    () => [{ label: 'Stage', onClick: () => {} }],
  )
  const menu = menuFor(deleted.file, deleted.file.path, false)
  entry(menu, 'View File before Deletion').onClick()
  expect(open).toHaveBeenLastCalledWith({ ...deleted, view: 'before' })
  expect(entry(menu, 'Stage')).toBeTruthy()
  const folder = menuFor(undefined, 'src', true)
  expect(folder.filter((i) => i !== 'separator').map((i) => i.label)).toEqual([
    'Stage',
    'Copy Absolute File Path',
    'Copy Relative File Path',
  ])
  entry(folder, 'Copy Absolute File Path').onClick()
  expect(copy).toHaveBeenLastCalledWith('/repo/src', 'Absolute path')
  const working = createFileMenu(
    '/repo',
    () => ({ ...target, to: 'WORKING' }),
    open,
    copy,
  )(target.file, target.file.path, false)
  expect(entry(working, 'View Diff with Working File').disabled).toBe(true)
})
