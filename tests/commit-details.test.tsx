// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  ActionResult,
  CommitDetails as Details,
  GraphData,
  UncommittedDetails,
} from '@shared/types'
import { api } from '@/api'
import { CommitDetails, type DetailsMode } from '@/components/CommitDetails'
import { DialogProvider } from '@/components/Dialog'
import { ToastProvider } from '@/components/Toast'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { useRepoActions } from '@/hooks/useRepoActions'
import { DEFAULT_SETTINGS } from '@/lib/settings'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const graph: GraphData = {
  commits: [],
  head: 'abc',
  currentBranch: 'main',
  refs: [],
  stashes: [],
  uncommitted: [],
  moreAvailable: false,
  remotes: [],
  upstream: null,
  userName: '',
  userEmail: '',
  state: {
    isEmpty: false,
    mergeInProgress: false,
    rebaseInProgress: false,
    cherryPickInProgress: false,
    revertInProgress: false,
  },
}
const empty: UncommittedDetails = { head: 'abc', staged: [], unstaged: [] }
const staged: UncommittedDetails = {
  ...empty,
  staged: [{ path: 'new.txt', status: 'A', additions: 1, deletions: 0 }],
}
const noop = () => {}
function Panel({
  repo = 'A',
  version = 0,
  data = graph,
  mode = { kind: 'uncommitted' },
}: {
  repo?: string
  version?: number
  data?: GraphData
  mode?: DetailsMode
}) {
  const actions = useRepoActions(repo, data, noop, DEFAULT_SETTINGS)
  return (
    <CommitDetails
      repo={repo}
      version={version}
      data={data}
      mode={mode}
      actions={actions}
      onOpenDiff={noop}
      onSelectCommit={noop}
      onClose={noop}
    />
  )
}
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
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
  vi.spyOn(api, 'uncommitted').mockResolvedValue(empty)
  vi.spyOn(api, 'action').mockResolvedValue({ ok: true, output: '' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('applies staged/message eligibility and an immediate in-flight guard to keyboard commit', async () => {
  const pending = deferred<ActionResult>()
  vi.mocked(api.action).mockReturnValue(pending.promise)
  const { rerender } = render(<Panel />, { wrapper: Wrapper })
  const textarea = await screen.findByRole('textbox')
  fireEvent.change(textarea, { target: { value: 'Useful change' } })
  fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
  expect(api.action).not.toHaveBeenCalled()
  const reload = deferred<UncommittedDetails>()
  vi.mocked(api.uncommitted).mockReturnValue(reload.promise)
  textarea.focus()
  rerender(<Panel version={1} />)
  expect(screen.getByRole('textbox')).toBe(textarea)
  expect(document.activeElement).toBe(textarea)
  fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
  expect(api.action).not.toHaveBeenCalled()
  await act(async () => reload.resolve(staged))
  const ready = screen.getByRole('textbox')
  expect((ready as HTMLTextAreaElement).value).toBe('Useful change')
  act(() => {
    fireEvent.keyDown(ready, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(ready, { key: 'Enter', ctrlKey: true })
  })
  expect(api.action).toHaveBeenCalledTimes(1)
  expect(api.action).toHaveBeenCalledWith('A', 'commit', { message: 'Useful change', amend: false })
  expect((screen.getByRole('button', { name: /^Commit/ }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => pending.resolve({ ok: true, output: '' }))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
  expect(api.action).toHaveBeenCalledTimes(1)
})

it('allows empty-message amend but prevents regular commit during an operation', async () => {
  const { rerender } = render(<Panel />, { wrapper: Wrapper })
  await screen.findByRole('textbox')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Amend last commit' }))
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('A', 'commit', { message: '', amend: true }),
  )
  rerender(<Panel data={{ ...graph, state: { ...graph.state, mergeInProgress: true } }} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
  expect(api.action).toHaveBeenCalledTimes(1)
})

it('opens the shared discard confirmation and preserves the untracked opt-in default', async () => {
  render(<Panel />, { wrapper: Wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'Discard All…' }))
  const checkbox = screen.getByRole('checkbox', { name: /untracked/i }) as HTMLInputElement
  expect(checkbox.checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Discard All' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('A', 'discardAll', { includeUntracked: false }),
  )
})

it('refreshes detail data by version, suppresses stale responses, and recovers after errors', async () => {
  const old = deferred<Details>()
  const current = deferred<Details>()
  vi.spyOn(api, 'commit').mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  const view = (version: number) => (
    <Panel version={version} mode={{ kind: 'commit', hash: 'abc' }} />
  )
  const { rerender } = render(view(0), { wrapper: Wrapper })
  rerender(view(1))
  await act(async () =>
    old.resolve({
      hash: 'abc',
      subject: 'Stale details',
      parents: [],
      author: '',
      email: '',
      date: 0,
      committer: '',
      committerEmail: '',
      commitDate: 0,
      body: '',
      files: [],
    }),
  )
  expect(screen.queryByText('Stale details')).toBeNull()
  await act(async () => current.reject(new Error('Detail unavailable')))
  expect(screen.getByText('Detail unavailable')).toBeTruthy()
  vi.mocked(api.commit).mockResolvedValue({
    hash: 'abc',
    subject: 'Current details',
    parents: [],
    author: '',
    email: '',
    date: 0,
    committer: '',
    committerEmail: '',
    commitDate: 0,
    body: '',
    files: [],
  })
  rerender(view(2))
  expect(await screen.findByText('Current details')).toBeTruthy()
  expect(api.commit).toHaveBeenCalledTimes(3)
})
