// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { DiffViewer, type DiffTarget } from '@/components/DiffViewer'
import { ToastProvider } from '@/components/Toast'
import { ThemeProvider } from '@/theme/ThemeProvider'

const target: DiffTarget = {
  file: { path: 'file.txt', status: 'M', additions: 0, deletions: 0 },
  from: 'HEAD',
  to: 'WORKING',
  label: 'Working tree',
}
function View({ open = true, value = target }: { open?: boolean; value?: DiffTarget }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {open && (
          <DiffViewer
            repo="A"
            target={value}
            diffStyle="unified"
            onDiffStyleChange={() => {}}
            onClose={() => {}}
          />
        )}
      </ToastProvider>
    </ThemeProvider>
  )
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('keeps a diff error and retry in the panel after the toast timeout', async () => {
  vi.useFakeTimers()
  vi.spyOn(api, 'fileDiff')
    .mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockResolvedValue({ patch: '', binary: true })
  await act(async () => {
    render(<View />)
  })
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('Could not load diff')
  expect(alert.closest('[aria-busy]')).not.toBeNull()
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  const details = screen.getByText('Technical details').closest('details')!
  expect(details.open).toBe(false)
  fireEvent.click(screen.getByText('Technical details'))
  expect(details.open).toBe(true)
  expect(details.textContent).toContain('Failed to fetch')
  expect(details.textContent).toContain('File: file.txt')
  expect(details.textContent).toContain('Comparison: HEAD → WORKING')
  act(() => vi.advanceTimersByTime(13_000))
  expect(screen.getByRole('alert')).toBe(alert)
  vi.useRealTimers()
  expect(screen.queryByText('Loading diff…')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Binary file — no textual diff available.')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(api.fileDiff).toHaveBeenCalledTimes(2)
})

it('shows loading during retry and restores the error with collapsed details if it fails again', async () => {
  let reject!: (error: Error) => void
  vi.spyOn(api, 'fileDiff')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no
        }),
    )
  render(<View />)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByText('Technical details'))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(screen.getByText('Loading diff…')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  await act(async () => reject(new Error('Still offline')))
  expect(screen.getByRole('alert').textContent).toContain('Still offline')
  expect(screen.getByText('Technical details').closest('details')!.open).toBe(false)
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  expect(api.fileDiff).toHaveBeenCalledTimes(2)
})

it('clears the previous error when selecting another target or view', async () => {
  vi.spyOn(api, 'fileDiff').mockRejectedValue(new Error('Offline'))
  vi.spyOn(api, 'fileContent').mockResolvedValue({ contents: '' })
  const { rerender } = render(<View />)
  await screen.findByRole('alert')
  const next = { ...target, file: { ...target.file, path: 'next.txt' } }
  rerender(<View value={next} />)
  expect(screen.queryByRole('alert')).toBeNull()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('File: next.txt')
  expect(alert.textContent).not.toContain('File: file.txt')
  fireEvent.change(screen.getByRole('combobox', { name: 'File view' }), {
    target: { value: 'working' },
  })
  expect(screen.queryByRole('alert')).toBeNull()
  await screen.findByText('Empty file.')
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})

it('dismisses the diff error when its view is closed', async () => {
  vi.spyOn(api, 'fileDiff').mockRejectedValue(new Error('Failed to fetch'))
  const { rerender } = render(<View />)
  await screen.findByRole('alert')
  rerender(<View open={false} />)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('ignores a diff failure arriving after its view is closed', async () => {
  let reject!: (error: Error) => void
  vi.spyOn(api, 'fileDiff').mockReturnValue(
    new Promise((_, no) => {
      reject = no
    }),
  )
  const { rerender } = render(<View />)
  rerender(<View open={false} />)
  await act(async () => reject(new Error('Late failure')))
  expect(screen.queryByRole('alert')).toBeNull()
})
