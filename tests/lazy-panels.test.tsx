// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { api } from '@/api'
import type { GraphData } from '@shared/types'

const pending = vi.hoisted(() => {
  let detailsReady!: () => void
  let diffReady!: () => void
  return {
    details: new Promise<void>((resolve) => {
      detailsReady = resolve
    }),
    diff: new Promise<void>((resolve) => {
      diffReady = resolve
    }),
    resolveDetails: () => detailsReady(),
    resolveDiff: () => diffReady(),
    detailsImported: vi.fn(),
    diffImported: vi.fn(),
  }
})

vi.mock('@/components/CommitDetails', async () => {
  pending.detailsImported()
  await pending.details
  return {
    CommitDetails: ({ onOpenDiff }: { onOpenDiff: (target: unknown) => void }) => (
      <button
        onClick={() =>
          onOpenDiff({
            file: { path: 'example.txt', status: 'M', additions: 1, deletions: 1 },
            from: 'HEAD',
            to: 'WORKING',
            label: 'example',
          })
        }
      >
        Open test diff
      </button>
    ),
  }
})
vi.mock('@/components/DiffViewer', async () => {
  pending.diffImported()
  await pending.diff
  return { DiffViewer: () => <div>Loaded test diff</div> }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps the graph available while details and diff modules load only on demand', async () => {
  localStorage.clear()
  localStorage.setItem('embegrav.settings', JSON.stringify({ autoRefresh: false }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const hash = 'a'.repeat(40)
  const data: GraphData = {
    commits: [
      {
        hash,
        parents: [],
        subject: 'Example commit',
        author: 'Test',
        email: '',
        date: 0,
        committer: 'Test',
        committerEmail: '',
        commitDate: 0,
      },
    ],
    head: hash,
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
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'repo', name: 'Example repo' }] })
  vi.spyOn(api, 'graph').mockResolvedValue(data)
  vi.spyOn(api, 'stats').mockResolvedValue({ stats: {} })
  vi.spyOn(api, 'capabilities').mockResolvedValue({ revealInFileExplorer: false })
  render(<App />)
  const row = await screen.findByText('Example commit')
  expect(pending.detailsImported).not.toHaveBeenCalled()
  expect(pending.diffImported).not.toHaveBeenCalled()
  fireEvent.click(row)
  expect(await screen.findByRole('status')).toBeTruthy()
  expect(screen.getByText('Example commit')).toBeTruthy()
  expect(screen.queryByText('Open test diff')).toBeNull()
  await act(async () => pending.resolveDetails())
  fireEvent.click(await screen.findByText('Open test diff'))
  expect(await screen.findByRole('status')).toBeTruthy()
  expect(screen.getByText('Example commit')).toBeTruthy()
  expect(screen.queryByText('Loaded test diff')).toBeNull()
  await act(async () => pending.resolveDiff())
  expect(await screen.findByText('Loaded test diff')).toBeTruthy()
  expect(pending.detailsImported).toHaveBeenCalledTimes(1)
  expect(pending.diffImported).toHaveBeenCalledTimes(1)
})
