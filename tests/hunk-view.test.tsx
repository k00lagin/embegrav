// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { DiffViewer, type DiffTarget } from '@/components/DiffViewer'
import { useRepoActions } from '@/hooks/useRepoActions'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { DialogProvider } from '@/components/Dialog'
import { ToastProvider } from '@/components/Toast'
import { ThemeProvider } from '@/theme/ThemeProvider'

vi.mock('@pierre/diffs/react', () => ({
  File: () => <pre />,
  PatchDiff: ({ patch }: { patch: string }) => <pre data-testid="patch">{patch}</pre>,
}))
const patch =
  'diff --git a/file.txt b/file.txt\nindex 1234567..abcdef0 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n-first\n+changed first\n context\n@@ -20,2 +20,2 @@\n-last\n+changed last\n context\n'
const target: DiffTarget = {
  file: { path: 'file.txt', status: 'M', additions: 2, deletions: 2, staged: false },
  from: 'INDEX',
  to: 'WORKING',
  label: 'Unstaged',
}
const refresh = vi.fn()
function Viewer({
  value = target,
  style = 'unified',
  version = 0,
}: {
  value?: DiffTarget
  style?: 'unified' | 'split'
  version?: number
}) {
  const actions = useRepoActions('R', null, refresh, DEFAULT_SETTINGS)
  return (
    <DiffViewer
      repo="R"
      target={value}
      actions={actions}
      version={version}
      diffStyle={style}
      onDiffStyleChange={() => {}}
      onClose={() => {}}
    />
  )
}
function View(props: Parameters<typeof Viewer>[0]) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DialogProvider>
          <Viewer {...props} />
        </DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
beforeEach(() => {
  vi.spyOn(api, 'fileDiff').mockResolvedValue({ patch, binary: false })
  vi.spyOn(api, 'action').mockResolvedValue({ ok: true, output: '' })
  refresh.mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it.each(['unified', 'split'] as const)(
  'stages one hunk in %s view, blocks duplicate clicks and reloads the diff',
  async (style) => {
    let finish!: (value: { ok: true; output: string }) => void
    vi.mocked(api.action).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    render(<View style={style} />)
    const first = await screen.findByRole('button', { name: 'Stage hunk 1' })
    const second = screen.getByRole('button', { name: 'Stage hunk 2' })
    expect(screen.getAllByTestId('patch')).toHaveLength(2)
    fireEvent.click(second)
    expect(second).toHaveProperty('disabled', true)
    expect(second.getAttribute('aria-busy')).toBe('true')
    expect(first).toHaveProperty('disabled', true)
    fireEvent.click(first)
    fireEvent.click(second)
    expect(api.action).toHaveBeenCalledExactlyOnceWith('R', 'stageHunk', {
      path: 'file.txt',
      patch,
      hunk: 1,
    })
    vi.mocked(api.fileDiff).mockResolvedValue({ patch: '', binary: false })
    await act(async () => finish({ ok: true, output: '' }))
    await screen.findByText('No textual changes (mode change or identical content).')
    expect(screen.getByLabelText('Change summary').textContent).toBe('+0 −0')
    expect(api.fileDiff).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Stage hunk 1' })).toBeNull()
  },
)

it('unstages an index hunk', async () => {
  render(<View value={{ ...target, from: 'HEAD', to: 'INDEX' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Unstage hunk 1' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('R', 'unstageHunk', {
      path: 'file.txt',
      patch,
      hunk: 0,
    }),
  )
  await waitFor(() => expect(api.fileDiff).toHaveBeenCalledTimes(2))
})

it.each([
  { ...target, from: 'parent', to: 'commit' },
  { ...target, from: 'HEAD', to: 'WORKING', workingComparison: true },
  { ...target, file: { ...target.file, status: 'U' as const } },
])(
  'does not offer hunk actions for history, whole-working-tree comparisons or conflicts: %j',
  async (value) => {
    render(<View value={value} />)
    await screen.findByTestId('patch')
    expect(screen.queryByRole('button', { name: /stage hunk/i })).toBeNull()
  },
)

it('reports stale-diff errors and reloads before allowing another action', async () => {
  vi.mocked(api.action).mockRejectedValue(new Error('The diff has changed. Reload it.'))
  render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stage hunk 1' }))
  expect((await screen.findByRole('alert')).textContent).toContain('The diff has changed')
  await waitFor(() => expect(api.fileDiff).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('button', { name: 'Stage hunk 1' })).toHaveProperty(
    'disabled',
    false,
  )
})

it('reloads mutable diffs on repository refresh', async () => {
  const { rerender } = render(<View />)
  await screen.findByRole('button', { name: 'Stage hunk 1' })
  vi.mocked(api.fileDiff).mockResolvedValue({ patch: '', binary: false })
  rerender(<View version={1} />)
  expect(screen.queryByRole('button', { name: 'Stage hunk 1' })).toBeNull()
  await screen.findByText('No textual changes (mode change or identical content).')
})
