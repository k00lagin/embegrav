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
  const { rerender } = render(<Panel />, { wrapper: Wrapper })
  const button = (await screen.findByRole('button', { name: 'Discard All…' })) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  vi.mocked(api.uncommitted).mockResolvedValue(staged)
  rerender(<Panel version={1} />)
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
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

it('fills in the previous message for amend and restores the draft when amend is turned off', async () => {
  vi.spyOn(api, 'commit').mockResolvedValue({
    hash: 'abc',
    subject: 'Previous subject',
    body: 'Previous body',
    parents: [],
    author: '',
    email: '',
    date: 0,
    committer: '',
    committerEmail: '',
    commitDate: 0,
    files: [],
  })
  render(<Panel />, { wrapper: Wrapper })
  const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: 'Work in progress' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Amend last commit' }))
  await waitFor(() => expect(textarea.value).toBe('Previous subject\n\nPrevious body'))
  expect(api.commit).toHaveBeenCalledWith('A', 'abc')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Amend last commit' }))
  expect(textarea.value).toBe('Work in progress')
})

it('keeps a per-repository draft, records sent messages, and hints at subject length', async () => {
  vi.mocked(api.uncommitted).mockResolvedValue(staged)
  const first = render(<Panel />, { wrapper: Wrapper })
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'x'.repeat(60) } })
  expect(screen.getByText('Subject 60/50')).toBeTruthy()
  first.unmount()
  const second = render(<Panel />, { wrapper: Wrapper })
  const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
  expect(textarea.value).toBe('x'.repeat(60))
  second.unmount()
  render(<Panel repo="B" />, { wrapper: Wrapper })
  expect(((await screen.findByRole('textbox')) as HTMLTextAreaElement).value).toBe('')
  cleanup()
  render(<Panel />, { wrapper: Wrapper })
  const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: 'Useful change' } })
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
  await waitFor(() => expect(box.value).toBe(''))
  expect(localStorage.getItem('embegrav.commitDraft:A')).toBe('""')
  fireEvent.click(screen.getByTitle('Recent commit messages'))
  fireEvent.click(screen.getByRole('button', { name: 'Useful change' }))
  expect(box.value).toBe('Useful change')
})

it('stages and unstages from inline row buttons and with Space', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.mocked(api.uncommitted).mockResolvedValue({
    ...staged,
    unstaged: [{ path: 'changed.txt', status: 'M', additions: 1, deletions: 1 }],
  })
  const { container } = render(<Panel />, { wrapper: Wrapper })
  await screen.findByRole('textbox')
  const roots = () =>
    [...container.querySelectorAll('file-tree-container')].map((host) => host.shadowRoot!)
  await waitFor(() =>
    expect(roots()[1]?.querySelector('[data-item-path="changed.txt"]')).toBeTruthy(),
  )
  const unstagedRow = roots()[1].querySelector('[data-item-path="changed.txt"]')!
  fireEvent.mouseMove(unstagedRow)
  fireEvent.click(await screen.findByRole('button', { name: 'Stage changed.txt' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('A', 'stage', { paths: ['changed.txt'] }),
  )
  const stagedRow = roots()[0].querySelector<HTMLElement>('[data-item-path="new.txt"]')!
  fireEvent.click(stagedRow)
  fireEvent.keyDown(stagedRow, { key: ' ' })
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('A', 'unstage', { paths: ['new.txt'] }),
  )
})
