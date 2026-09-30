// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import type { GraphData } from '@shared/types'
import { api, getSession, setSession, UnauthorizedError } from '@/api'
import { App } from '@/App'
import { DEFAULT_SETTINGS } from '@/lib/settings'

const HASH = 'a'.repeat(40)
const graph: GraphData = {
  commits: [
    {
      hash: HASH,
      parents: [],
      subject: 'Initial',
      author: 'Ann',
      email: 'ann@example.com',
      date: 1_700_000_000,
      committer: 'Ann',
      committerEmail: 'ann@example.com',
      commitDate: 1_700_000_000,
    },
  ],
  head: HASH,
  currentBranch: 'main',
  refs: [{ type: 'head', name: 'main', hash: HASH }],
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
const TOKEN = 'ABCD2345EFGH'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  setSession(null)
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
  vi.spyOn(api, 'graph').mockResolvedValue(graph)
  vi.spyOn(api, 'stats').mockResolvedValue({ stats: {} })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setSession(null)
  window.history.replaceState(null, '', '/')
})

it('pairs from successive hash links in the same tab, including under StrictMode', async () => {
  window.history.replaceState(null, '', '/?repo=R')
  vi.spyOn(api, 'graph').mockRestore()
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/auth/pair') {
      const { token } = JSON.parse(String(init.body))
      return token === TOKEN ? json({ session: 'S' }) : json({ error: 'Expired token' }, 401)
    }
    if (new Headers(init.headers).get('authorization') !== 'Bearer S') {
      return json({ error: 'Not paired' }, 401)
    }
    return url === '/api/graph'
      ? json(graph)
      : json({ repos: [{ path: 'R', name: 'Repo R' }], added: [{ path: 'R', name: 'Repo R' }] })
  })
  vi.stubGlobal('fetch', fetch)
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  await screen.findByRole('textbox', { name: 'Pairing token' })

  act(() => {
    window.location.hash = '#token=expired'
  })
  await screen.findByText('Expired token')
  act(() => {
    window.location.hash = `#token=${TOKEN}&keep=1`
  })
  expect(await screen.findByText('Initial')).toBeTruthy()
  expect(fetch.mock.calls.filter(([url]) => url === '/api/auth/pair')).toHaveLength(2)
  expect(window.location.hash).toBe('#keep=1')
  expect(fetch).toHaveBeenCalledWith(
    '/api/repos',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: 'R' }),
    }),
  )
})

it('redeems an initial link only once under StrictMode', async () => {
  window.history.replaceState(null, '', `/#token=${TOKEN}`)
  const pair = vi.spyOn(api, 'pair').mockResolvedValue({ session: 'S' })
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'R', name: 'Repo R' }] })
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  expect(await screen.findByText('Initial')).toBeTruthy()
  expect(pair).toHaveBeenCalledTimes(1)
})

it('keeps a fresh session when an older request returns 401 after pairing', async () => {
  setSession('old')
  let finishOld!: (response: Response) => void
  const oldResponse = new Promise<Response>((resolve) => {
    finishOld = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/browse/home') return oldResponse
      if (url === '/api/auth/pair') return json({ session: 'new' })
      return new Headers(init.headers).get('authorization') === 'Bearer new'
        ? json({ repos: [{ path: 'R', name: 'Repo R' }] })
        : json({ error: 'Revoked' }, 401)
    }),
  )
  const oldRequest = api.browseHome().catch((error: unknown) => error)
  render(<App />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Pairing token' }), {
    target: { value: TOKEN },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
  await screen.findByText('Initial')
  await act(async () => {
    finishOld(json({ error: 'Revoked' }, 401))
    expect(await oldRequest).toBeInstanceOf(UnauthorizedError)
  })
  expect(screen.queryByRole('textbox', { name: 'Pairing token' })).toBeNull()
  expect(getSession()).toBe('new')
  expect(screen.getByText('Initial')).toBeTruthy()
})

it.each(['QuotaExceededError', 'SecurityError'])(
  'keeps pairing usable when storage throws %s',
  async (errorName) => {
    localStorage.setItem('embegrav.session', JSON.stringify('revoked'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', errorName)
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url === '/api/auth/pair') return json({ session: 'S' })
        return new Headers(init.headers).get('authorization') === 'Bearer S'
          ? json({ repos: [{ path: 'R', name: 'Repo R' }] })
          : json({ error: 'Not paired' }, 401)
      }),
    )
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Pairing token' }), {
      target: { value: TOKEN },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
    expect(await screen.findByText('Initial')).toBeTruthy()
    expect(getSession()).toBe('S')
    expect(localStorage.getItem('embegrav.session')).toBe(JSON.stringify('revoked'))
    setSession(null)
    expect(getSession()).toBeNull()
  },
)

it('pairs from a link, stores the session, opens the linked repository and cleans the URL', async () => {
  window.history.replaceState(
    null,
    '',
    `/?repo=${encodeURIComponent('C:\\src\\app')}#token=${TOKEN}&keep=1`,
  )
  vi.spyOn(api, 'pair').mockResolvedValue({ session: 'S' })
  const addRepo = vi.spyOn(api, 'addRepo').mockResolvedValue({
    repos: [
      { path: 'C:\\other', name: 'other' },
      { path: 'C:\\src\\app', name: 'app' },
    ],
    added: [{ path: 'C:\\src\\app', name: 'app' }],
  })
  render(<App />)
  expect(await screen.findByText('Initial')).toBeTruthy()
  expect(api.pair).toHaveBeenCalledTimes(1)
  expect(api.pair).toHaveBeenCalledWith(TOKEN)
  expect(getSession()).toBe('S')
  expect(addRepo).toHaveBeenCalledWith('C:\\src\\app')
  expect(screen.getByRole('button', { name: 'app' })).toBeTruthy()
  expect(window.location.search).toBe('')
  expect(window.location.hash).toBe('#keep=1')
})

it('ignores a pairing token in the query string', async () => {
  window.history.replaceState(null, '', `/?token=${TOKEN}`)
  vi.spyOn(api, 'pair')
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'R', name: 'Repo R' }] })
  render(<App />)
  expect(await screen.findByText('Initial')).toBeTruthy()
  expect(api.pair).not.toHaveBeenCalled()
})

it('keeps a working session instead of redeeming another pairing token', async () => {
  localStorage.setItem('embegrav.session', JSON.stringify('existing'))
  window.history.replaceState(null, '', `/#token=${TOKEN}`)
  vi.spyOn(api, 'checkSession').mockResolvedValue({ ok: true })
  vi.spyOn(api, 'pair')
  vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ path: 'R', name: 'Repo R' }] })
  render(<App />)
  expect(await screen.findByText('Initial')).toBeTruthy()
  expect(api.pair).not.toHaveBeenCalled()
  expect(getSession()).toBe('existing')
})

it('shows the pairing screen when the server rejects the browser and resumes after pairing', async () => {
  window.history.replaceState(null, '', `/?repo=R`)
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const paired = new Headers(init.headers).get('authorization') === 'Bearer S'
    if (url === '/api/auth/pair') {
      return JSON.parse(String(init.body)).token === TOKEN
        ? json({ session: 'S' })
        : json({ error: 'The pairing token is invalid, expired or already used' }, 401)
    }
    if (url === '/api/repos' && paired) {
      return json({
        repos: [{ path: 'R', name: 'Repo R' }],
        added: [{ path: 'R', name: 'Repo R' }],
      })
    }
    if (url === '/api/capabilities' && paired) {
      return json({ revealInFileExplorer: true })
    }
    return json({ error: 'This browser is not paired with the server' }, 401)
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)

  const input = await screen.findByRole('textbox', { name: 'Pairing token' })
  fireEvent.change(input, { target: { value: 'wrongtoken22' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
  expect(
    await screen.findByText('The pairing token is invalid, expired or already used'),
  ).toBeTruthy()

  fireEvent.change(input, { target: { value: ` ${TOKEN} ` } })
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
  expect(await screen.findByText('Initial')).toBeTruthy()
  expect(getSession()).toBe('S')
  // The linked repository is opened once the browser is paired.
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/repos',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ path: 'R' }) }),
    ),
  )
})
