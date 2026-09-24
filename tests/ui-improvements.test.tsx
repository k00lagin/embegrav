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
  render(<App />)
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
  fireEvent.click(screen.getByRole('button', { name: 'Author' }))
  expect(screen.queryByRole('columnheader', { name: 'Author' })).toBeNull()
  expect(screen.queryByText('Ann')).toBeNull()
  expect(JSON.parse(localStorage.getItem('embegrav.columns')!)).toEqual({
    hidden: ['author'],
    widths: {},
  })
})

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
  expect(screen.getByRole('button', { name: 'Merge feature/search into main…' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Rebase main on feature/search…' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Delete Branch…' }))
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
