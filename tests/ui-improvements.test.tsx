// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CommitDetails, GitCommit, GraphData } from '@shared/types'
import { api } from '@/api'
import { App } from '@/App'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { BRANCH_DRAG_TYPE } from '@/components/RefLabel'

function commit(hash: string, parents: string[], subject: string): GitCommit {
  return {
    hash,
    parents,
    subject,
    author: 'Ann',
    email: 'ann@example.com',
    date: 1_700_000_000,
    committer: 'Ann',
    committerEmail: 'ann@example.com',
    commitDate: 1_700_000_000,
  }
}
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const graph: GraphData = {
  commits: [commit(A, [B], 'Fix typo'), commit(B, [C], 'Add search'), commit(C, [], 'Initial')],
  head: A,
  currentBranch: 'main',
  refs: [
    { type: 'head', name: 'main', hash: A, remote: 'origin', upstream: 'origin/main' },
    { type: 'remote', name: 'origin/main', hash: A, remote: 'origin' },
    { type: 'head', name: 'feature/search', hash: B, remote: 'origin' },
    { type: 'remote', name: 'origin/feature/search', hash: C, remote: 'origin' },
  ],
  stashes: [],
  uncommitted: [],
  moreAvailable: false,
  remotes: [{ name: 'origin', url: 'https://example.com/repo.git' }],
  upstream: { name: 'origin/main', ahead: 0, behind: 0 },
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
function details(hash: string): CommitDetails {
  const c = graph.commits.find((x) => x.hash === hash)!
  return { ...c, subject: `Details of ${c.subject}`, body: '', files: [] }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(
    'embegrav.settings',
    JSON.stringify({ ...DEFAULT_SETTINGS, autoRefresh: false }),
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = () => {}
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'R', name: 'Repo R' }] })
  vi.spyOn(api, 'graph').mockResolvedValue(graph)
  vi.spyOn(api, 'stats').mockResolvedValue({ stats: {} })
  vi.spyOn(api, 'commit').mockImplementation(async (_repo, hash) => details(hash))
  vi.spyOn(api, 'compare').mockResolvedValue({ from: C, to: B, files: [] })
  vi.spyOn(api, 'action').mockResolvedValue({ ok: true, output: '' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const row = (hash: string) => document.getElementById(`commit-${hash}`)!

it('keeps details while loading a missing parent, then selects and focuses it', async () => {
  let finish!: (value: GraphData) => void
  vi.mocked(api.graph)
    .mockResolvedValueOnce({ ...graph, commits: [graph.commits[0]], moreAvailable: true })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  render(<App />)
  fireEvent.click(await screen.findByText('Fix typo'))
  fireEvent.click(await screen.findByRole('button', { name: B.slice(0, 8) }))
  expect(screen.getByText('Details of Fix typo')).toBeTruthy()
  await waitFor(() => expect(api.graph).toHaveBeenCalledTimes(2))
  await act(async () => finish(graph))
  await waitFor(() => expect(document.activeElement).toBe(row(B)))
  expect(row(B).getAttribute('aria-selected')).toBe('true')
  expect(await screen.findByText('Details of Add search')).toBeTruthy()
})

it.each(['Fetch from all remotes', 'Pull from origin/main', 'Push to origin/main', 'Continue'])(
  'shows pending state and prevents another %s',
  async (title) => {
    let finish!: (value: { ok: true; output: string }) => void
    vi.mocked(api.graph).mockResolvedValue({
      ...graph,
      state: { ...graph.state, rebaseInProgress: true },
    })
    vi.mocked(api.action).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    render(<App />)
    const button =
      title === 'Continue'
        ? await screen.findByRole('button', { name: title })
        : (await screen.findAllByTitle(title))[0]
    await waitFor(() => expect(button).toHaveProperty('disabled', false))
    fireEvent.click(button)
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('.animate-spin')).toBeTruthy()
    if (title.startsWith('Pull') || title.startsWith('Push')) {
      for (const other of screen.getAllByTitle(title)) {
        expect(other).toHaveProperty('disabled', true)
        expect(other.getAttribute('aria-busy')).toBe('true')
      }
      expect(
        screen.getByTitle(
          title.startsWith('Pull')
            ? 'Pull with options (remote, branch, rebase)…'
            : 'Push with options (remote, set upstream, force with lease)…',
        ),
      ).toHaveProperty('disabled', true)
    }
    fireEvent.click(button)
    expect(api.action).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: true, output: '' }))
    expect(button).toHaveProperty('disabled', false)
  },
)

it('navigates to an unloaded hash from Find without changing the branch filter', async () => {
  localStorage.setItem('embegrav.branches:R', JSON.stringify(['main']))
  vi.mocked(api.graph)
    .mockResolvedValueOnce({ ...graph, commits: [graph.commits[0]], moreAvailable: true })
    .mockResolvedValueOnce({ ...graph, commits: graph.commits.slice(0, 2), moreAvailable: true })
    .mockResolvedValue(graph)
  vi.mocked(api.commit).mockImplementation(async (_repo, hash) =>
    details(hash === C.slice(0, 8) ? C : hash),
  )
  render(<App />)
  fireEvent.click(await screen.findByText('Fix typo'))
  fireEvent.click(screen.getByTitle('Find (Ctrl+F)'))
  const input = screen.getByPlaceholderText('Find (message, author, hash, ref)')
  fireEvent.change(input, { target: { value: C.slice(0, 8) } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(document.activeElement).toBe(row(C)))
  expect(row(C).getAttribute('aria-selected')).toBe('true')
  expect(api.graph).toHaveBeenCalledTimes(3)
  for (const [request] of vi.mocked(api.graph).mock.calls)
    expect(request.branches).toEqual(['main'])
})

it.each(['unified', 'split'] as const)(
  'preserves %s details when a commit is excluded by the filters',
  async (commitView) => {
    localStorage.setItem(
      'embegrav.settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, autoRefresh: false, commitView }),
    )
    localStorage.setItem('embegrav.branches:R', JSON.stringify(['main']))
    vi.mocked(api.graph)
      .mockResolvedValueOnce({ ...graph, commits: [graph.commits[0]], moreAvailable: true })
      .mockResolvedValue({ ...graph, commits: [graph.commits[0]], moreAvailable: false })
    render(<App />)
    fireEvent.click(await screen.findByText('Fix typo'))
    fireEvent.click(await screen.findByRole('button', { name: B.slice(0, 8) }))
    expect(await screen.findByText('Commit is not in the current history')).toBeTruthy()
    expect(screen.getByText('Details of Fix typo')).toBeTruthy()
    expect(row(A).getAttribute('aria-selected')).toBe('true')
    expect(api.graph).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Branch: main' })).toBeTruthy()
  },
)

it.each(['selection', 'keyboard', 'close', 'filter', 'repository'])(
  'cancels a pending parent jump on %s change',
  async (change) => {
    let finish!: (value: GraphData) => void
    vi.mocked(api.repos).mockResolvedValue({
      repos: [
        { path: 'R', name: 'Repo R' },
        { path: 'S', name: 'Repo S' },
      ],
    })
    const initial = { ...graph, commits: [graph.commits[0], graph.commits[2]], moreAvailable: true }
    vi.mocked(api.graph)
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue(graph)
    render(<App />)
    fireEvent.click(await screen.findByText('Fix typo'))
    fireEvent.click(await screen.findByRole('button', { name: B.slice(0, 8) }))
    await waitFor(() => expect(api.graph).toHaveBeenCalledTimes(2))
    if (change === 'selection') fireEvent.click(row(C))
    if (change === 'keyboard') fireEvent.keyDown(row(A), { key: 'ArrowDown' })
    if (change === 'close') fireEvent.keyDown(window, { key: 'Escape' })
    if (change === 'filter') {
      fireEvent.click(screen.getByRole('button', { name: 'Branches: Show All' }))
      fireEvent.click(screen.getByRole('button', { name: 'main' }))
      await waitFor(() => expect(api.graph).toHaveBeenCalledTimes(3))
    }
    if (change === 'repository') {
      fireEvent.click(screen.getByRole('button', { name: 'Repo R' }))
      fireEvent.click(screen.getByRole('button', { name: 'Repo SS' }))
      await waitFor(() => expect(api.graph).toHaveBeenCalledTimes(3))
    }
    await act(async () => finish(graph))
    expect(row(B).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByText('Details of Add search')).toBeNull()
    if (change === 'selection' || change === 'keyboard') {
      expect(row(C).getAttribute('aria-selected')).toBe('true')
    }
  },
)

it('preserves the current details when parent history fails to load', async () => {
  vi.mocked(api.graph)
    .mockResolvedValueOnce({ ...graph, commits: [graph.commits[0]], moreAvailable: true })
    .mockRejectedValue(new Error('History unavailable'))
  render(<App />)
  fireEvent.click(await screen.findByText('Fix typo'))
  fireEvent.click(await screen.findByRole('button', { name: B.slice(0, 8) }))
  expect((await screen.findByRole('alert')).textContent).toContain('History unavailable')
  expect(screen.getByText('Details of Fix typo')).toBeTruthy()
  expect(api.graph).toHaveBeenCalledTimes(2)
})

it('ignores hash resolution after switching repositories, even when returning to the first one', async () => {
  let finish!: (value: CommitDetails) => void
  vi.mocked(api.repos).mockResolvedValue({
    repos: [
      { path: 'R', name: 'Repo R' },
      { path: 'S', name: 'Repo S' },
    ],
  })
  vi.mocked(api.graph).mockResolvedValue({
    ...graph,
    commits: [graph.commits[0]],
    moreAvailable: true,
  })
  vi.mocked(api.commit).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  render(<App />)
  await screen.findByText('Fix typo')
  fireEvent.click(screen.getByTitle('Find (Ctrl+F)'))
  const input = screen.getByPlaceholderText('Find (message, author, hash, ref)')
  fireEvent.change(input, { target: { value: C.slice(0, 8) } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(api.commit).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Repo R' }))
  fireEvent.click(screen.getByRole('button', { name: 'Repo SS' }))
  await screen.findByText('Fix typo')
  fireEvent.click(screen.getByRole('button', { name: 'Repo S' }))
  fireEvent.click(screen.getByRole('button', { name: 'Repo RR' }))
  await screen.findByText('Fix typo')
  await act(async () => finish(details(C)))
  expect(api.graph).toHaveBeenCalledTimes(3)
  expect(row(A).getAttribute('aria-selected')).toBe('false')
})

const stashes = [B, C].map((hash, index) => ({
  selector: `stash@{${index}}`,
  index,
  hash,
  baseHash: A,
  message: index === 0 ? 'WIP: Search dialog' : 'On main: Old layout',
  date: 1_700_000_000 - index,
}))
const stashGraph: GraphData = {
  ...graph,
  stashes,
  commits: graph.commits.map((c) => ({ ...c, stash: stashes.find((s) => s.hash === c.hash) })),
}

it('filters status branches, handles no matches and resets the search when reopened', async () => {
  render(<App />)
  const button = await screen.findByRole('button', { name: 'Switch branch (main)' })
  fireEvent.click(button)
  const input = screen.getByRole('textbox', { name: 'Search branches' })
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'missing' } })
  expect(screen.getByText('No results')).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: 'main' })).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(api.action).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.click(button)
  const reopened = screen.getByRole('textbox', { name: 'Search branches' })
  expect(reopened).toHaveProperty('value', '')
  fireEvent.change(reopened, { target: { value: ' SEARCH ' } })
  expect(screen.queryByRole('menuitem', { name: 'main' })).toBeNull()
  fireEvent.keyDown(reopened, { key: 'Enter' })
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('R', 'checkoutBranch', { name: 'feature/search' }),
  )
})

it('filters stashes by message and selector and navigates to their rows without applying them', async () => {
  vi.mocked(api.graph).mockResolvedValue(stashGraph)
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  render(<App />)
  const button = await screen.findByRole('button', { name: '2 stashes' })
  fireEvent.click(button)
  const input = screen.getByRole('textbox', { name: 'Search stashes' })
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: ' SEARCH ' } })
  expect(screen.queryByRole('menuitem', { name: 'stash@{1}: On main: Old layout' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'stash@{0}: WIP: Search dialog' }))
  await waitFor(() => expect(document.activeElement).toBe(row(B)))
  expect(row(B).getAttribute('aria-selected')).toBe('true')
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  expect(screen.queryByRole('textbox', { name: 'Search stashes' })).toBeNull()
  fireEvent.click(button)
  const reopened = screen.getByRole('textbox', { name: 'Search stashes' })
  expect(reopened).toHaveProperty('value', '')
  fireEvent.change(reopened, { target: { value: 'stash@{1}' } })
  expect(screen.queryByRole('menuitem', { name: 'stash@{0}: WIP: Search dialog' })).toBeNull()
  fireEvent.keyDown(reopened, { key: 'Enter' })
  await waitFor(() => expect(document.activeElement).toBe(row(C)))
  expect(row(C).getAttribute('aria-selected')).toBe('true')
  expect(api.action).not.toHaveBeenCalled()
})

it('loads more history until the stash selected in the status menu is visible', async () => {
  vi.mocked(api.graph)
    .mockResolvedValueOnce({
      ...stashGraph,
      commits: stashGraph.commits.slice(0, 1),
      moreAvailable: true,
    })
    .mockResolvedValueOnce({
      ...stashGraph,
      commits: stashGraph.commits.slice(0, 2),
      moreAvailable: true,
    })
    .mockResolvedValue(stashGraph)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '2 stashes' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'stash@{1}: On main: Old layout' }))
  await waitFor(() => expect(document.activeElement).toBe(row(C)))
  expect(row(C).getAttribute('aria-selected')).toBe('true')
  expect(api.graph).toHaveBeenCalledTimes(3)
  expect(vi.mocked(api.graph).mock.calls.map(([request]) => request.maxCommits)).toEqual([
    DEFAULT_SETTINGS.maxCommits,
    DEFAULT_SETTINGS.maxCommits * 2,
    DEFAULT_SETTINGS.maxCommits * 4,
  ])
})

it('stops loading a stash when the repository request fails', async () => {
  vi.mocked(api.graph)
    .mockResolvedValueOnce({ ...stashGraph, commits: [], moreAvailable: true })
    .mockRejectedValue(new Error('History unavailable'))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '2 stashes' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'stash@{1}: On main: Old layout' }))
  expect((await screen.findByRole('alert')).textContent).toContain('History unavailable')
  expect(api.graph).toHaveBeenCalledTimes(2)
})

it('stops loading history when the server returns no additional commits', async () => {
  vi.mocked(api.graph).mockResolvedValue({
    ...stashGraph,
    commits: [graph.commits[0]],
    moreAvailable: true,
  })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '2 stashes' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'stash@{1}: On main: Old layout' }))
  expect(await screen.findByText('Could not find stash in the loaded history')).toBeTruthy()
  expect(api.graph).toHaveBeenCalledTimes(2)
})

it('switches local branches from the status bar and refreshes the repository', async () => {
  render(<App />)
  const status = screen.getByRole('group', { name: 'Repository status' })
  fireEvent.click(await within(status).findByRole('button', { name: 'Switch branch (main)' }))
  expect(screen.getByRole('menuitem', { name: 'main' })).toHaveProperty('ariaDisabled', 'true')
  expect(screen.queryByRole('menuitem', { name: 'origin/main' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'feature/search' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('R', 'checkoutBranch', { name: 'feature/search' }),
  )
  await waitFor(() => expect(api.graph).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('menuitem', { name: 'feature/search' })).toBeNull()
})

it('allows branch switching from detached HEAD but disables it during a merge', async () => {
  vi.mocked(api.graph).mockResolvedValue({ ...graph, currentBranch: null, upstream: null })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Switch branch (detached HEAD)' }))
  expect(screen.getByRole('menuitem', { name: 'main' })).toHaveProperty('ariaDisabled', null)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('menuitem', { name: 'main' })).toBeNull()
  vi.mocked(api.graph).mockResolvedValue({
    ...graph,
    state: { ...graph.state, mergeInProgress: true },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh (F5)' }))
  expect(await screen.findByRole('button', { name: 'Switch branch (main)' })).toHaveProperty(
    'disabled',
    true,
  )
  expect(api.action).not.toHaveBeenCalled()
})

it('runs push and pull from the status counters through the existing actions', async () => {
  vi.mocked(api.graph).mockResolvedValue({
    ...graph,
    upstream: { name: 'origin/main', ahead: 2, behind: 3 },
  })
  render(<App />)
  const status = screen.getByRole('group', { name: 'Repository status' })
  fireEvent.click(
    await within(status).findByRole('button', { name: 'Push to origin/main (2 ahead)' }),
  )
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('R', 'push', { remote: 'origin', branch: 'main' }),
  )
  await screen.findByText('Push main to origin/main')
  vi.mocked(api.action).mockRejectedValueOnce(new Error('Network unavailable'))
  fireEvent.click(within(status).getByRole('button', { name: 'Pull from origin/main (3 behind)' }))
  await waitFor(() => expect(api.action).toHaveBeenCalledWith('R', 'pull', {}))
  expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable')
})

it('uses a graph icon only while the header text does not fit, including after font changes', async () => {
  let available = 20
  let textWidth = 35
  let resized!: () => void
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const rect = originalRect.call(this)
    if (this.tagName === 'SPAN' && this.textContent === 'Graph')
      return { ...rect, width: this.getAttribute('aria-hidden') === 'true' ? available : textWidth }
    return rect
  })
  const { unmount } = render(<App />)
  const header = await screen.findByRole('columnheader', { name: 'Graph' })
  const label = within(header).getByText('Graph')
  expect(header.querySelector('svg')).toBeTruthy()
  expect(label.classList.contains('invisible')).toBe(true)
  expect(header.title).toBe('Graph')
  act(() => {
    available = 40
    resized()
  })
  expect(header.querySelector('svg')).toBeNull()
  expect(label.classList.contains('invisible')).toBe(false)
  act(() => {
    textWidth = 45
    resized()
  })
  expect(header.querySelector('svg')).toBeTruthy()
  expect(label.classList.contains('invisible')).toBe(true)
  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('merges a local branch label with its identical upstream and keeps diverged ones apart', async () => {
  render(<App />)
  await screen.findByText('Fix typo')
  const head = within(row(A))
  expect(head.getByText('main')).toBeTruthy()
  expect(head.getByText(/⇄\s*origin/)).toBeTruthy()
  expect(head.queryByText('origin/main')).toBeNull()
  expect(within(row(B)).getByText('feature/search')).toBeTruthy()
  expect(within(row(C)).getByText('origin/feature/search')).toBeTruthy()
})

it('toggles unified details by clicking the selected row and still closes them with Esc', async () => {
  render(<App />)
  fireEvent.click(await screen.findByText('Add search'))
  expect(await screen.findByText('Details of Add search')).toBeTruthy()
  fireEvent.click(screen.getByText('Add search'))
  expect(screen.queryByText('Details of Add search')).toBeNull()
  fireEvent.click(screen.getByText('Add search'))
  expect(await screen.findByText('Details of Add search')).toBeTruthy()
  fireEvent.keyDown(row(B), { key: 'Escape' })
  expect(screen.queryByText('Details of Add search')).toBeNull()
})

it('keeps split details open on repeated row clicks until the close button is clicked', async () => {
  localStorage.setItem(
    'embegrav.settings',
    JSON.stringify({ ...DEFAULT_SETTINGS, autoRefresh: false, commitView: 'split' }),
  )
  render(<App />)
  fireEvent.click(await screen.findByText('Add search'))
  expect(await screen.findByText('Details of Add search')).toBeTruthy()
  fireEvent.click(row(B))
  expect(screen.getByText('Details of Add search')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close details (Esc)' }))
  expect(screen.queryByText('Details of Add search')).toBeNull()
})

it('navigates rows with the keyboard, opens details, compares, and jumps to HEAD', async () => {
  // Flush the initial graph/stat effects before dispatching keyboard navigation.
  await act(async () => {
    render(<App />)
  })
  await screen.findByText('Fix typo')
  row(A).focus()
  fireEvent.keyDown(row(A), { key: 'ArrowDown' })
  await waitFor(() => expect(document.activeElement).toBe(row(B)))
  expect(screen.queryByText(/^Details of/)).toBeNull()
  fireEvent.keyDown(row(B), { key: 'Enter' })
  expect(await screen.findByText('Details of Add search')).toBeTruthy()
  fireEvent.keyDown(row(B), { key: 'j' })
  expect(await screen.findByText('Details of Initial')).toBeTruthy()
  expect(document.activeElement).toBe(row(C))
  fireEvent.keyDown(row(C), { key: 'k', shiftKey: false })
  expect(await screen.findByText('Details of Add search')).toBeTruthy()
  fireEvent.keyDown(row(B), { key: 'ArrowDown', shiftKey: true })
  await waitFor(() => expect(api.compare).toHaveBeenCalledWith('R', C, B))
  fireEvent.keyDown(row(C), { key: 'Home' })
  await waitFor(() => expect(document.activeElement).toBe(row(A)))
  fireEvent.keyDown(row(A), { key: 'End' })
  await waitFor(() => expect(document.activeElement).toBe(row(C)))
  fireEvent.keyDown(row(C), { key: 'h', ctrlKey: true })
  await waitFor(() => expect(document.activeElement).toBe(row(A)))
})

it('hides columns from the header menu and persists the layout', async () => {
  render(<App />)
  await screen.findByText('Fix typo')
  expect(screen.getByRole('columnheader', { name: 'Author' })).toBeTruthy()
  fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'Author' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Author' }))
  expect(screen.queryByRole('columnheader', { name: 'Author' })).toBeNull()
  expect(screen.queryByText('Ann')).toBeNull()
  expect(JSON.parse(localStorage.getItem('embegrav.columns')!)).toEqual({
    hidden: ['author'],
    widths: {},
  })
})

it.each(['F10', 'ContextMenu'])(
  'opens the graph context menu with %s and resumes graph navigation after Escape',
  async (key) => {
    render(<App />)
    await screen.findByText('Fix typo')
    row(B).focus()
    fireEvent.keyDown(row(B), { key: 'Enter' })
    expect(await screen.findByText('Details of Add search')).toBeTruthy()
    fireEvent.keyDown(row(B), { key, shiftKey: key === 'F10' })
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(row(B))
    expect(screen.getByText('Details of Add search')).toBeTruthy()
    fireEvent.keyDown(row(B), { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(row(C)))
  },
)

it('offers undo after removing a repository from the list', async () => {
  vi.spyOn(api, 'removeRepo').mockResolvedValue({ repos: [] })
  const restored = { path: 'R', name: 'Repo R' }
  vi.spyOn(api, 'addRepo').mockResolvedValue({ repos: [restored], added: [restored] })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Repo R' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }))
  await screen.findByText(/No repositories registered/)
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(api.addRepo).toHaveBeenCalledWith('R'))
  expect(await screen.findByText('Fix typo')).toBeTruthy()
})

it('offers merge and rebase when a branch label is dropped on the current branch', async () => {
  render(<App />)
  await screen.findByText('Fix typo')
  const dataTransfer = {
    types: [BRANCH_DRAG_TYPE],
    getData: (type: string) => (type === BRANCH_DRAG_TYPE ? 'feature/search' : ''),
    dropEffect: 'none',
  }
  fireEvent.dragOver(row(A), { dataTransfer })
  fireEvent.drop(within(row(A)).getByText('main'), { dataTransfer })
  expect(screen.getByRole('menuitem', { name: 'Merge feature/search into main…' })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rebase main on feature/search…' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Rebase' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('R', 'rebase', {
      ref: 'feature/search',
      preserveMerges: false,
    }),
  )
})

it('shows an Undo action for undoable results and runs the returned step', async () => {
  vi.mocked(api.action).mockResolvedValueOnce({
    ok: true,
    output: 'Deleted branch feature/search',
    undo: {
      label: 'Restore branch feature/search',
      action: 'restoreBranch',
      args: { name: 'feature/search', hash: B },
    },
  })
  render(<App />)
  fireEvent.click(await screen.findByText('feature/search'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Branch…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const undo = await screen.findByRole('button', { name: 'Undo' })
  await act(async () => fireEvent.click(undo))
  expect(api.action).toHaveBeenLastCalledWith('R', 'restoreBranch', {
    name: 'feature/search',
    hash: B,
  })
})

it('searches branches and toggles remote branches from the branch filter', async () => {
  render(<App />)
  await screen.findByText('Fix typo')
  expect(screen.queryByText('Show Remote Branches')).toBeNull()
  fireEvent.click(screen.getByTitle('Filter the graph to selected branches'))
  const search = screen.getByRole('textbox', { name: 'Search branches' })
  expect(document.activeElement).toBe(search)
  const panel = within(search.closest('.dropdown-panel') as HTMLElement)
  fireEvent.change(search, { target: { value: 'SEARCH' } })
  expect(panel.getByText('feature/search')).toBeTruthy()
  expect(panel.getByText('origin/feature/search')).toBeTruthy()
  expect(panel.queryByText('origin/main')).toBeNull()
  fireEvent.click(panel.getByRole('checkbox', { name: 'Show remote branches' }))
  expect(JSON.parse(localStorage.getItem('embegrav.settings')!).showRemoteBranches).toBe(false)
  expect(panel.queryByText('origin/feature/search')).toBeNull()
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(screen.getByTitle('Filter the graph to selected branches').textContent).toContain(
    'Branch: feature/search',
  )
  fireEvent.change(search, { target: { value: 'nope' } })
  expect(panel.getByText('No matching branches')).toBeTruthy()
})
