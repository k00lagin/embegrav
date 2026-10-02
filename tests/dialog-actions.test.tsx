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
import type { GitCommit, GitHubAccount, GraphData } from '../shared/types'

vi.mock('../src/api', () => ({ api: { action: vi.fn(), githubAccount: vi.fn() } }))
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
      <button onClick={() => void actions.pullWithOptions()}>Open pull</button>
      <button onClick={() => void actions.pushWithOptions()}>Open push</button>
      <button onClick={() => void actions.pull()}>Quick pull</button>
      <button onClick={() => void actions.push()}>Quick push</button>
      <button onClick={() => void actions.discardAll()}>Direct discard</button>
      <button onClick={() => void actions.publishToGitHub()}>Open publish</button>
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

it('pulls and pushes the configured upstream in one click, asking only without one', async () => {
  setup({
    ...data,
    refs: [{ type: 'head', name: 'main', hash: commit.hash, remote: 'upstream' }],
    upstream: { name: 'upstream/release/main', ahead: 1, behind: 1 },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Quick pull' }))
  await waitFor(() => expect(api.action).toHaveBeenCalledWith('/disposable/repo', 'pull', {}))
  fireEvent.click(screen.getByRole('button', { name: 'Quick push' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('/disposable/repo', 'push', {
      remote: 'upstream',
      branch: 'main:release/main',
    }),
  )
  expect(screen.queryByLabelText('Remote')).toBeNull()
  cleanup()
  vi.mocked(api.action).mockClear()
  setup({ ...data, refs: [{ type: 'head', name: 'main', hash: commit.hash }], upstream: null })
  fireEvent.click(screen.getByRole('button', { name: 'Quick push' }))
  expect((screen.getByLabelText('Set upstream (-u)') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quick pull' }))
  expect(screen.getByLabelText('Remote branch')).toBeTruthy()
  expect(api.action).not.toHaveBeenCalled()
})

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

it('publishes to a private GitHub repository by default and to a public one on request', async () => {
  vi.mocked(api.githubAccount).mockResolvedValue({
    login: 'me',
    owners: ['me', 'acme'],
    via: 'gcm',
  })
  setup({ ...data, remotes: [] })
  fireEvent.click(screen.getByRole('button', { name: 'Open publish' }))
  const name = (await screen.findByLabelText('Repository name')) as HTMLInputElement
  expect(name.value).toBe('repo')
  expect((screen.getByLabelText('Owner') as HTMLSelectElement).value).toBe('me')
  expect(screen.getByText(/Signed in as me via Git Credential Manager/)).toBeTruthy()
  expect((screen.getByLabelText('Remote name') as HTMLInputElement).value).toBe('origin')
  expect((screen.getByRole('radio', { name: /Private/ }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('/disposable/repo', 'publishGitHub', {
      via: 'gcm',
      name: 'repo',
      owner: 'me',
      visibility: 'private',
      remote: 'origin',
      push: true,
    }),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Open publish' }))
  fireEvent.change(await screen.findByLabelText('Repository name'), {
    target: { value: 'bad name' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  expect(screen.getByText(/may contain only letters/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'site' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'acme' } })
  fireEvent.change(screen.getByLabelText('Description (optional)'), {
    target: { value: ' Docs ' },
  })
  fireEvent.click(screen.getByRole('radio', { name: /Public/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await waitFor(() =>
    expect(api.action).toHaveBeenLastCalledWith('/disposable/repo', 'publishGitHub', {
      via: 'gcm',
      name: 'site',
      owner: 'acme',
      visibility: 'public',
      remote: 'origin',
      push: true,
      description: 'Docs',
    }),
  )
})

it.each(['/B', '/A', null])(
  'discards late publish account results after changing repositories and ending at %s',
  async (destination) => {
    let resolveAccount!: (account: GitHubAccount) => void
    vi.mocked(api.githubAccount).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccount = resolve
        }),
    )
    const { result, rerender } = renderHook(
      ({ repo }: { repo: string | null }) => useRepoActions(repo, data, vi.fn(), DEFAULT_SETTINGS),
      { initialProps: { repo: '/A' as string | null }, wrapper: Wrapper },
    )
    let publishing!: Promise<boolean>
    act(() => {
      publishing = result.current.publishToGitHub()
    })
    rerender({ repo: '/B' })
    rerender({ repo: destination })
    await act(async () => {
      resolveAccount({ login: 'me', owners: ['me'], via: 'gh' })
      expect(await publishing).toBe(false)
    })
    expect(screen.queryByLabelText('Repository name')).toBeNull()
    expect(screen.queryByText('Connecting to GitHub…')).toBeNull()
    expect(api.action).not.toHaveBeenCalled()
  },
)

it('does not submit a publish dialog belonging to a previous repository visit', async () => {
  vi.mocked(api.githubAccount).mockResolvedValue({ login: 'me', owners: ['me'], via: 'gh' })
  const { result, rerender } = renderHook(
    ({ repo }) => useRepoActions(repo, data, vi.fn(), DEFAULT_SETTINGS),
    { initialProps: { repo: '/A' }, wrapper: Wrapper },
  )
  let publishing!: Promise<boolean>
  act(() => {
    publishing = result.current.publishToGitHub()
  })
  await screen.findByLabelText('Repository name')
  rerender({ repo: '/B' })
  rerender({ repo: '/A' })
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await act(async () => {
    expect(await publishing).toBe(false)
  })
  expect(api.action).not.toHaveBeenCalled()
})

it('keeps publishing available through same-repository graph refreshes', async () => {
  let resolveAccount!: (account: GitHubAccount) => void
  vi.mocked(api.githubAccount).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveAccount = resolve
      }),
  )
  vi.mocked(api.action).mockResolvedValue({ ok: true, output: '' })
  const { result, rerender } = renderHook(
    ({ graph }) => useRepoActions('/A', graph, vi.fn(), DEFAULT_SETTINGS),
    { initialProps: { graph: data }, wrapper: Wrapper },
  )
  let publishing!: Promise<boolean>
  act(() => {
    publishing = result.current.publishToGitHub()
  })
  rerender({ graph: { ...data } })
  await act(async () => {
    resolveAccount({ login: 'me', owners: ['me'], via: 'gh' })
  })
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await act(async () => {
    expect(await publishing).toBe(true)
  })
  expect(api.action).toHaveBeenCalledWith('/A', 'publishGitHub', expect.any(Object))
})

it('reports a missing GitHub CLI without opening the publish dialog', async () => {
  vi.mocked(api.githubAccount).mockRejectedValue(new Error('GitHub CLI (gh) was not found.'))
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Open publish' }))
  expect(await screen.findByText('GitHub CLI (gh) was not found.')).toBeTruthy()
  expect(screen.queryByLabelText('Repository name')).toBeNull()
  expect(api.action).not.toHaveBeenCalled()
})

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
