import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Hono } from 'hono'
import {
  bearerToken,
  createPairingToken,
  isValidSession,
  normalizePairingToken,
  redeemPairingToken,
} from '../server/auth.ts'

const run = promisify(execFile)
const originalHome = process.env.EMBEGRAV_HOME
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'embegrav-auth-'))
  process.env.EMBEGRAV_HOME = home
})
afterEach(async () => {
  process.env.EMBEGRAV_HOME = originalHome
  vi.restoreAllMocks()
  vi.doUnmock('@hono/node-server')
  vi.doUnmock('../server/repos.ts')
  vi.doUnmock('../server/explorer.ts')
  await rm(home, { recursive: true, force: true })
})

it('issues readable single-use pairing tokens that become sessions', async () => {
  const { token, expiresAt } = await createPairingToken(60_000, 1_000)
  expect(token).toMatch(/^[2-9A-HJ-NP-Z]{12}$/)
  expect(expiresAt).toBe(61_000)

  const session = await redeemPairingToken(token.toLowerCase(), 'test-agent', 2_000)
  expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(await isValidSession(session)).toBe(true)
  expect(await redeemPairingToken(token, '', 2_000)).toBeNull()
  // Only hashes are stored on disk.
  const names = [
    ...(await readdir(join(home, 'sessions'))),
    ...(await readdir(join(home, 'pairing'))),
  ]
  expect(names.join()).not.toContain(token)
  expect(names.join()).not.toContain(session)
})

it('rejects expired, unknown and malformed pairing tokens and sessions', async () => {
  const { token } = await createPairingToken(60_000, 0)
  expect(await redeemPairingToken(token, '', 60_000)).toBeNull()
  expect(await redeemPairingToken(token, '', 1)).toBeNull() // consumed by the expired attempt
  expect(await redeemPairingToken('ZZZZZZZZZZZZ')).toBeNull()
  expect(normalizePairingToken(' abcd2345efgh ')).toBe('ABCD2345EFGH')
  expect(normalizePairingToken('ABCD2345EFG0')).toBeNull()
  expect(normalizePairingToken(42)).toBeNull()
  expect(await isValidSession('x'.repeat(43))).toBe(false)
  expect(await isValidSession('../../etc/passwd')).toBe(false)
  expect(await isValidSession(undefined)).toBe(false)
  expect(bearerToken('Bearer abc')).toBe('abc')
  expect(bearerToken('Basic abc')).toBeNull()
})

it('lets only one of several concurrent redemptions succeed', async () => {
  const { token } = await createPairingToken()
  const results = await Promise.all(Array.from({ length: 10 }, () => redeemPairingToken(token)))
  expect(results.filter(Boolean)).toHaveLength(1)
})

it('removes expired pairing tokens when issuing a new one', async () => {
  await createPairingToken(1_000, 0)
  await createPairingToken(1_000, 5_000)
  expect(await readdir(join(home, 'pairing'))).toHaveLength(1)
})

async function startServer(): Promise<Hono['fetch']> {
  vi.resetModules()
  let fetchRequest!: Hono['fetch']
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.doMock('@hono/node-server', () => ({
    serve: (options: { fetch: Hono['fetch'] }) => {
      fetchRequest = options.fetch
    },
  }))
  vi.doMock('../server/repos.ts', () => ({
    registerPath: async () => [{ path: 'test-repo', name: 'test' }],
    listRepos: () => [{ path: 'test-repo', name: 'test' }],
    getRepo: () => ({ path: 'test-repo', name: 'test' }),
    removeRepo: vi.fn(),
  }))
  const argv = process.argv
  process.argv = [process.execPath, 'server/index.ts', 'test-repo']
  try {
    await import('../server/index.ts')
    await vi.waitFor(() => expect(fetchRequest).toBeDefined())
  } finally {
    process.argv = argv
  }
  return fetchRequest
}

it('answers API requests only for paired sessions', async () => {
  const fetchRequest = await startServer()
  const call = (path: string, init?: RequestInit) =>
    fetchRequest(new Request(`http://localhost${path}`, init))

  const unpaired = await call('/api/repos')
  expect(unpaired.status).toBe(401)
  expect(await unpaired.json()).toMatchObject({ code: 'unauthorized' })
  // Cross-site "simple" requests carry no Authorization header and are rejected too.
  expect(
    (
      await call('/api/action', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ repo: 'test-repo', action: 'discardAll', args: {} }),
      })
    ).status,
  ).toBe(401)

  const bad = await call('/api/auth/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'ZZZZZZZZZZZZ' }),
  })
  expect(bad.status).toBe(401)

  const { token } = await createPairingToken()
  const paired = await call('/api/auth/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const { session } = (await paired.json()) as { session: string }
  const authorization = `Bearer ${session}`

  expect((await call('/api/repos', { headers: { authorization } })).status).toBe(200)
  expect(
    (await call('/api/auth/session', { method: 'POST', headers: { authorization } })).status,
  ).toBe(200)
  // The query-string fallback exists only for EventSource.
  expect((await call(`/api/repos?session=${session}`)).status).toBe(401)
})

it.each([
  ['127.0.0.1', 'http://localhost', 200],
  ['192.168.1.20', 'http://localhost', 403],
  ['127.0.0.1', 'http://remote.example', 403],
])('allows revealing only through local access (%s, %s)', async (address, origin, status) => {
  const reveal = vi.fn().mockResolvedValue(undefined)
  vi.doMock('../server/explorer.ts', () => ({ revealInFileExplorer: reveal }))
  const fetchRequest = await startServer()
  const { token } = await createPairingToken()
  const session = await redeemPairingToken(token)
  const env = { incoming: { socket: { remoteAddress: address } } }
  const headers = { authorization: `Bearer ${session}`, 'content-type': 'application/json' }
  const capabilities = await fetchRequest(
    new Request(`${origin}/api/capabilities`, { headers }),
    env,
  )
  expect(await capabilities.json()).toEqual({ revealInFileExplorer: status === 200 })
  const response = await fetchRequest(
    new Request(`${origin}/api/repos/reveal`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: 'test-repo' }),
    }),
    env,
  )
  expect(response.status).toBe(status)
  expect(reveal).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
})

it.each([
  ['127.0.0.1', 'http://127.0.0.1:4000'],
  ['::1', 'http://[::1]:4000'],
  ['::', 'http://localhost:4000'],
])('prints a usable pairing link for host %s', async (host, origin) => {
  const entry = fileURLToPath(new URL('../bin/embegrav.js', import.meta.url))
  const { stdout } = await run(
    process.execPath,
    [entry, 'pair', '--repo', 'some/repo', '--port', '4000', '--ttl', '10', '--host', host],
    { env: { ...process.env, EMBEGRAV_HOME: home } },
  )
  const token = /Pairing token: (\w+) \(single use, expires in 10 min\)/.exec(stdout)?.[1]
  expect(token).toBeTruthy()
  const link = new URL(/Open: (\S+)/.exec(stdout)![1])
  expect(link.origin).toBe(origin)
  expect(link.searchParams.has('token')).toBe(false)
  expect(link.hash).toBe(`#token=${token}`)
  expect(link.searchParams.get('repo')).toBe(resolve('some/repo'))
  expect(await redeemPairingToken(token)).toBeTruthy()
})
