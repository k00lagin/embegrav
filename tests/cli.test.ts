import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Hono } from 'hono'

const run = promisify(execFile)

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('node:child_process')
  vi.doUnmock('node:fs')
  vi.doUnmock('@hono/node-server')
  vi.doUnmock('../server/repos.ts')
  vi.doUnmock('../server/watcher.ts')
})

it('releases an SSE subscription when the client disconnects during watcher initialization', async () => {
  vi.resetModules()
  let resolveSubscription!: (unsubscribe: () => void) => void
  const pendingSubscription = new Promise<() => void>((resolve) => {
    resolveSubscription = resolve
  })
  const subscribe = vi.fn(() => pendingSubscription)
  const serve = vi.fn()
  let fetchRequest!: Hono['fetch']
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.doMock('@hono/node-server', () => ({
    serve: (options: { fetch: Hono['fetch'] }) => {
      fetchRequest = options.fetch
      serve()
    },
  }))
  vi.doMock('../server/repos.ts', () => ({
    registerPath: async () => [{ path: 'test-repo', name: 'test' }],
    listRepos: () => [],
    getRepo: () => ({ path: 'test-repo', name: 'test' }),
    removeRepo: vi.fn(),
  }))
  vi.doMock('../server/watcher.ts', () => ({ subscribe }))
  const argv = process.argv
  process.argv = [process.execPath, 'server/index.ts', 'test-repo']
  try {
    await import('../server/index.ts')
    await vi.waitFor(() => expect(serve).toHaveBeenCalledTimes(1))
    const response = await fetchRequest(new Request('http://localhost/api/events?repo=test-repo'))
    expect(subscribe).toHaveBeenCalledTimes(1)
    await response.body!.cancel()
    const unsubscribe = vi.fn()
    resolveSubscription(unsubscribe)
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1), { timeout: 500 })
  } finally {
    process.argv = argv
  }
})

it('runs the linked CLI help from an unrelated directory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'repotree-cli-'))
  try {
    const entry = fileURLToPath(new URL('../bin/repotree.js', import.meta.url))
    const { stdout, stderr } = await run(process.execPath, [entry, '--help'], { cwd })
    expect(stdout).toContain('Usage: repotree')
    expect(stderr).toBe('')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

it('handles an asynchronous browser launcher error without crashing the server', async () => {
  vi.resetModules()
  const launcher = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const spawn = vi.fn(() => launcher)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.doMock('node:child_process', async (original) => ({
    ...(await original<typeof import('node:child_process')>()),
    spawn,
  }))
  vi.doMock('node:fs', async (original) => ({
    ...(await original<typeof import('node:fs')>()),
    existsSync: () => true,
  }))
  vi.doMock('@hono/node-server', () => ({
    serve: (_options: unknown, onListening: (info: { port: number }) => void) =>
      onListening({ port: 3210 }),
  }))
  vi.doMock('../server/repos.ts', () => ({
    registerPath: async () => [{ path: 'test-repo', name: 'test' }],
    listRepos: () => [],
    getRepo: vi.fn(),
    removeRepo: vi.fn(),
  }))
  const argv = process.argv
  process.argv = [process.execPath, 'server/index.ts', '--open', 'test-repo']
  try {
    await import('../server/index.ts')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(launcher.unref).toHaveBeenCalledTimes(1)
    expect(() => launcher.emit('error', new Error('launcher unavailable'))).not.toThrow()
    expect(warn).toHaveBeenCalledWith('Could not open browser: launcher unavailable')
  } finally {
    process.argv = argv
  }
})
