// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphData, GraphRequest } from '@shared/types'
import { api } from '@/api'
import { App } from '@/App'
import { UNCOMMITTED } from '@/lib/format'
import { StrictMode } from 'react'
import { useRepoGraph } from '@/hooks/useRepoGraph'
import { useRepoActions } from '@/hooks/useRepoActions'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { DialogProvider } from '@/components/Dialog'
import { ToastProvider } from '@/components/Toast'
import type { ReactNode } from 'react'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function request(repo: string): GraphRequest {
  return {
    repo,
    maxCommits: 20,
    branches: null,
    showRemoteBranches: true,
    order: 'date',
    showStashes: true,
    showTags: true,
  }
}
function graph(branch: string): GraphData {
  return {
    commits: [],
    head: null,
    currentBranch: branch,
    refs: [],
    stashes: [],
    uncommitted: [],
    moreAvailable: false,
    remotes: [],
    upstream: null,
    userName: '',
    userEmail: '',
    state: {
      isEmpty: true,
      mergeInProgress: false,
      rebaseInProgress: false,
      cherryPickInProgress: false,
      revertInProgress: false,
    },
  }
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>
    <DialogProvider>{children}</DialogProvider>
  </ToastProvider>
)

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  localStorage.clear()
  localStorage.setItem(
    'embegrav.settings',
    JSON.stringify({ ...DEFAULT_SETTINGS, autoRefresh: false }),
  )
  vi.spyOn(api, 'stats').mockResolvedValue({ stats: {} })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('repository ownership', () => {
  it('hides A immediately, keeps it hidden when B fails, and rejects late A results', async () => {
    const a = deferred<GraphData>()
    const b = deferred<GraphData>()
    const initialA = graph('A')
    vi.spyOn(api, 'graph')
      .mockResolvedValueOnce(initialA)
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
    const { result, rerender } = renderHook(({ req }) => useRepoGraph(req), {
      initialProps: { req: request('A') as GraphRequest | null },
    })
    await waitFor(() => expect(result.current.data).toBe(initialA))
    act(() => result.current.refresh())
    rerender({ req: request('B') })
    expect(result.current.data).toBeNull()
    await act(async () => b.reject(new Error('B unavailable')))
    expect(result.current.error).toBe('B unavailable')
    await act(async () => a.resolve(graph('late A')))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('B unavailable')
  })

  it('a completed A action cannot refresh over B or revive a previous A visit', async () => {
    const action = deferred<{ ok: true; output: string }>()
    vi.spyOn(api, 'graph').mockImplementation(async ({ repo }) => graph(repo))
    vi.spyOn(api, 'action').mockReturnValue(action.promise)
    const { result, rerender } = renderHook(
      ({ req }) => {
        const state = useRepoGraph(req)
        const actions = useRepoActions(req.repo, state.data, state.refresh, DEFAULT_SETTINGS)
        return { ...state, actions }
      },
      { initialProps: { req: request('A') }, wrapper },
    )
    await waitFor(() => expect(result.current.data?.currentBranch).toBe('A'))
    const firstARefresh = result.current.refresh
    let running!: Promise<boolean>
    act(() => {
      running = result.current.actions.run('Fetch', 'fetch', {})
    })
    rerender({ req: request('B') })
    await waitFor(() => expect(result.current.data?.currentBranch).toBe('B'))
    await act(async () => {
      action.resolve({ ok: true, output: '' })
      await running
    })
    expect(api.graph).toHaveBeenCalledTimes(2)
    expect(result.current.data?.currentBranch).toBe('B')
    const oldRefresh = result.current.refresh
    rerender({ req: request('A') })
    await waitFor(() => expect(result.current.data?.currentBranch).toBe('A'))
    act(() => {
      oldRefresh()
      firstARefresh()
    })
    expect(api.graph).toHaveBeenCalledTimes(3)
  })

  it('null invalidates pending requests and stale refresh callbacks', async () => {
    const a = deferred<GraphData>()
    vi.spyOn(api, 'graph').mockReturnValue(a.promise)
    const { result, rerender } = renderHook(({ req }) => useRepoGraph(req), {
      initialProps: { req: request('A') as GraphRequest | null },
    })
    const refresh = result.current.refresh
    rerender({ req: null })
    await act(async () => {
      a.resolve(graph('A'))
      refresh()
    })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(api.graph).toHaveBeenCalledTimes(1)
  })

  it('keeps late stats within their repository', async () => {
    const aStats = deferred<{
      stats: Record<string, { files: number; additions: number; deletions: number }>
    }>()
    const a = graph('A')
    a.uncommitted = [{ path: 'file', index: '.', work: 'M', untracked: false, conflicted: false }]
    vi.spyOn(api, 'graph').mockResolvedValue(a)
    vi.mocked(api.stats).mockReturnValueOnce(aStats.promise)
    const { result, rerender } = renderHook(({ req }) => useRepoGraph(req), {
      initialProps: { req: request('A') },
    })
    await waitFor(() => expect(api.stats).toHaveBeenCalledTimes(1))
    vi.mocked(api.graph).mockResolvedValue(graph('B'))
    rerender({ req: request('B') })
    await waitFor(() => expect(result.current.data?.currentBranch).toBe('B'))
    await act(async () =>
      aStats.resolve({ stats: { file: { files: 1, additions: 99, deletions: 0 } } }),
    )
    expect(result.current.stats).toEqual({})
    expect(api.stats).toHaveBeenCalledTimes(1)
  })
})

it('refreshes the latest same-repository filters and survives StrictMode effect replay', async () => {
  vi.spyOn(api, 'graph').mockImplementation(async ({ maxCommits }) => graph(`limit-${maxCommits}`))
  const { result, rerender } = renderHook(({ req }) => useRepoGraph(req), {
    initialProps: { req: request('A') },
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  })
  await waitFor(() => expect(result.current.data?.currentBranch).toBe('limit-20'))
  const refresh = result.current.refresh
  rerender({ req: { ...request('A'), maxCommits: 40 } })
  await waitFor(() => expect(result.current.data?.currentBranch).toBe('limit-40'))
  act(refresh)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(api.graph).toHaveBeenLastCalledWith(expect.objectContaining({ maxCommits: 40 }))
})

it('wires App repository selection to owned graph data and explicit prepared merge completion', async () => {
  vi.spyOn(api, 'repos').mockResolvedValue({
    repos: [
      { path: 'A', name: 'Repo A' },
      { path: 'B', name: 'Repo B' },
    ],
  })
  const a = graph('branch-A')
  a.state.mergeInProgress = true
  const b = deferred<GraphData>()
  vi.spyOn(api, 'graph').mockResolvedValueOnce(a).mockReturnValue(b.promise)
  vi.spyOn(api, 'action').mockResolvedValue({ ok: true, output: '' })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Commit Merge' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('A', 'commit', { messageMode: 'prepared' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Repo A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Repo BB' }))
  expect(screen.queryByText('branch-A')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Commit Merge' })).toBeNull()
  await act(async () => b.reject(new Error('B failed to load')))
  expect(screen.getByText('B failed to load')).toBeTruthy()
  expect(screen.queryByText('branch-A')).toBeNull()
})

it('updates uncommitted stats once per graph refresh without a cache-triggered fetch loop', async () => {
  vi.spyOn(api, 'graph').mockImplementation(async () => ({
    ...graph('A'),
    uncommitted: [{ path: 'file', index: '.', work: 'M', untracked: false, conflicted: false }],
  }))
  const first = { files: 1, additions: 1, deletions: 0 }
  const second = { files: 1, additions: 2, deletions: 0 }
  vi.mocked(api.stats)
    .mockResolvedValueOnce({ stats: { [UNCOMMITTED]: first } })
    .mockResolvedValueOnce({ stats: { [UNCOMMITTED]: second } })
  const req = request('A')
  const { result } = renderHook(() => useRepoGraph(req))
  await waitFor(() => expect(result.current.stats[UNCOMMITTED]).toEqual(first))
  expect(api.stats).toHaveBeenCalledTimes(1)
  act(result.current.refresh)
  await waitFor(() => expect(result.current.stats[UNCOMMITTED]).toEqual(second))
  expect(api.stats).toHaveBeenCalledTimes(2)
})

it('removing the active repository keeps the empty App clear when its request finishes', async () => {
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'A', name: 'Repo A' }] })
  vi.spyOn(api, 'removeRepo').mockResolvedValue({ repos: [] })
  const pending = deferred<GraphData>()
  vi.spyOn(api, 'graph').mockReturnValue(pending.promise)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Repo A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }))
  await screen.findByText(/No repositories registered/)
  await act(async () => pending.resolve(graph('removed-branch')))
  expect(screen.queryByText('removed-branch')).toBeNull()
  expect(screen.getByRole('button', { name: 'Select repository' })).toBeTruthy()
})

it('shows graph errors only in a toast, preserves loaded data, and retries repeated failures', async () => {
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'A', name: 'Repo A' }] })
  vi.spyOn(api, 'graph')
    .mockResolvedValueOnce(graph('branch-A'))
    .mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockResolvedValue(graph('recovered-A'))
  render(<App />)
  await screen.findByText('branch-A')
  fireEvent.keyDown(window, { key: 'F5' })
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByText('Failed to fetch')).toBeTruthy()
  expect(screen.getAllByText('Failed to fetch')).toHaveLength(1)
  expect(screen.getByText('branch-A')).toBeTruthy()
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
  const repeated = await screen.findByRole('alert')
  expect(within(repeated).getByText('Failed to fetch')).toBeTruthy()
  fireEvent.click(within(repeated).getByRole('button', { name: 'Retry' }))
  await screen.findByText('recovered-A')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(api.graph).toHaveBeenCalledTimes(4)
})

it('dismisses graph load errors when selecting another repository', async () => {
  vi.spyOn(api, 'repos').mockResolvedValue({
    repos: [
      { path: 'A', name: 'Repo A' },
      { path: 'B', name: 'Repo B' },
    ],
  })
  vi.spyOn(api, 'graph')
    .mockRejectedValueOnce(new Error('A unavailable'))
    .mockResolvedValue(graph('branch-B'))
  render(<App />)
  await screen.findByRole('alert')
  expect(screen.queryByText('Loading repository…')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Repo A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Repo BB' }))
  await screen.findByText('branch-B')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reports removal failures without dropping the current repository', async () => {
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'A', name: 'Repo A' }] })
  vi.spyOn(api, 'graph').mockResolvedValue(graph('branch-A'))
  vi.spyOn(api, 'removeRepo').mockRejectedValue(new Error('Server unavailable'))
  render(<App />)
  await screen.findByText('branch-A')
  fireEvent.click(screen.getByRole('button', { name: 'Repo A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not remove repository')
  expect(screen.getByText('branch-A')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('does not change the new selection when removal of the previously selected repo finishes', async () => {
  const repos = [
    { path: 'A', name: 'Repo A' },
    { path: 'B', name: 'Repo B' },
    { path: 'C', name: 'Repo C' },
  ]
  vi.spyOn(api, 'repos').mockResolvedValue({ repos })
  vi.spyOn(api, 'graph').mockImplementation(async ({ repo }) => graph(`branch-${repo}`))
  const removal = deferred<{ repos: typeof repos }>()
  vi.spyOn(api, 'removeRepo').mockReturnValue(removal.promise)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Repo A' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove from list' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Repo A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Repo BB' }))
  await screen.findByText('branch-B')
  await act(async () => removal.resolve({ repos: [repos[2], repos[1]] }))
  expect(screen.getByRole('button', { name: 'Repo B' })).toBeTruthy()
  expect(screen.getByText('branch-B')).toBeTruthy()
})
