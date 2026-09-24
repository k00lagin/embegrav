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
function View({ open = true }: { open?: boolean }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {open && (
          <DiffViewer
            repo="A"
            target={target}
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
  vi.restoreAllMocks()
})

it('retries a failed diff from its toast without leaving the loading indicator stuck', async () => {
  vi.spyOn(api, 'fileDiff')
    .mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockResolvedValue({ patch: '', binary: true })
  render(<View />)
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load diff for file.txt',
  )
  expect(screen.queryByText('Loading diff…')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Binary file — no textual diff available.')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(api.fileDiff).toHaveBeenCalledTimes(2)
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
