// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { DialogProvider, useDialog } from '../src/components/Dialog'
import { ToastProvider } from '../src/components/Toast'
import { useRepoActions } from '../src/hooks/useRepoActions'
import { DEFAULT_SETTINGS } from '../src/lib/settings'
import { api } from '../src/api'
import type { GitCommit, GraphData } from '../shared/types'

vi.mock('../src/api', () => ({ api: { action: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const commit: GitCommit = {
  hash: 'abc123',
  parents: [],
  author: 'Test',
  email: 'test@example.com',
  date: 0,
  committer: 'Test',
  committerEmail: 'test@example.com',
  commitDate: 0,
  subject: 'base',
}
const data: GraphData = {
  commits: [commit],
  head: commit.hash,
  currentBranch: 'main',
  refs: [],
  stashes: [],
  uncommitted: [],
  moreAvailable: false,
  remotes: [
    { name: 'origin', url: 'unused-origin' },
    { name: 'upstream', url: 'unused-upstream' },
  ],
  state: {
    mergeInProgress: false,
    rebaseInProgress: false,
    cherryPickInProgress: false,
    revertInProgress: false,
    isEmpty: false,
  },
  upstream: null,
  userName: 'Test',
  userEmail: 'test@example.com',
}

function Harness({ graph = data }: { graph?: GraphData }) {
  const actions = useRepoActions('/disposable/repo', graph, vi.fn(), DEFAULT_SETTINGS)
  const tagMenu = actions.refMenu(
    { kind: 'ref', ref: { type: 'tag', name: 'v1', hash: commit.hash } },
    commit,
  )
  const menu = actions.uncommittedMenu()
  return (
    <>
      {tagMenu
        .filter((item) => item !== 'separator')
        .map((item) => (
          <button key={item.label} onClick={item.onClick}>
            {item.label}
          </button>
        ))}
      <button onClick={() => void actions.pull()}>Open pull</button>
      <button onClick={() => void actions.push()}>Open push</button>
      <button onClick={() => void actions.discardAll()}>Direct discard</button>
      {menu
        .filter((item) => item !== 'separator')
        .map((item) => (
          <button key={item.label} onClick={item.onClick}>
            {item.label}
          </button>
        ))}
    </>
  )
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DialogProvider>{children}</DialogProvider>
    </ToastProvider>
  )
}
function setup(graph = data) {
  vi.mocked(api.action).mockResolvedValue({ ok: true, output: '' })
  render(<Harness graph={graph} />, { wrapper: Wrapper })
}

it('deletes a tag locally by default', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Delete Tag…' }))
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  expect((screen.getByLabelText('Remote') as HTMLSelectElement).value).toBe('origin')
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
  expect(api.action).toHaveBeenCalledWith('/disposable/repo', 'deleteTag', { name: 'v1' })
})

it('keeps remote selection independent from explicit deletion consent', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Delete Tag…' }))
  const remote = screen.getByLabelText('Remote') as HTMLSelectElement
  const consent = screen.getByRole('checkbox') as HTMLInputElement
  fireEvent.change(remote, { target: { value: 'upstream' } })
  expect(consent.checked).toBe(false)
  fireEvent.click(consent)
  fireEvent.click(consent)
  expect(remote.value).toBe('upstream')
  expect(consent.checked).toBe(false)
  fireEvent.click(consent)
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
  expect(api.action).toHaveBeenNthCalledWith(2, '/disposable/repo', 'deleteRemoteTag', {
    name: 'v1',
    remote: 'upstream',
  })
})

it.each([true, false])(
  'pairs pull defaults with the configured upstream (configured=%s)',
  async (configured) => {
    setup({
      ...data,
      refs: [
        {
          type: 'head',
          name: 'main',
          hash: commit.hash,
          remote: configured ? 'upstream' : undefined,
        },
      ],
      upstream: configured ? { name: 'upstream/release/main', ahead: 0, behind: 0 } : null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open pull' }))
    expect((screen.getByLabelText('Remote') as HTMLSelectElement).value).toBe(
      configured ? 'upstream' : 'origin',
    )
    expect((screen.getByLabelText('Remote branch') as HTMLInputElement).value).toBe(
      configured ? 'release/main' : 'main',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith('/disposable/repo', 'pull', {
        remote: configured ? 'upstream' : 'origin',
        branch: configured ? 'release/main' : 'main',
        rebase: false,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open push' }))
    expect((screen.getByLabelText('Remote') as HTMLSelectElement).value).toBe(
      configured ? 'upstream' : 'origin',
    )
    expect((screen.getByLabelText('Set upstream (-u)') as HTMLInputElement).checked).toBe(
      !configured,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  },
)

it.each(['Direct discard', 'Discard All Changes…'])(
  'keeps confirmation and untracked opt-in for %s',
  async (entry) => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: entry }))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: entry }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard All' }))
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith('/disposable/repo', 'discardAll', {
        includeUntracked: false,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: entry }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Discard All' }))
    await waitFor(() =>
      expect(api.action).toHaveBeenLastCalledWith('/disposable/repo', 'discardAll', {
        includeUntracked: true,
      }),
    )
  },
)

it('rejects duplicate dialog field names before opening', () => {
  const { result } = renderHook(useDialog, { wrapper: DialogProvider })
  expect(() =>
    act(() => {
      void result.current.open({
        title: 'Invalid',
        fields: [
          { type: 'checkbox', name: 'remote', label: 'Consent' },
          {
            type: 'select',
            name: 'remote',
            label: 'Remote',
            options: [{ value: 'origin', label: 'Origin' }],
          },
        ],
      })
    }),
  ).toThrow('Duplicate dialog field: remote')
  expect(screen.queryByText('Invalid')).toBeNull()
})
