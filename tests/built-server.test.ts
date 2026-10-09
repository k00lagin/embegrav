import { expect, it } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { git } from '../server/git.ts'

const run = promisify(execFile)

it('serves the built UI outside the package directory and pairs only on explicit request', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'embegrav-built-'))
  const home = join(cwd, 'state')
  const entry = fileURLToPath(new URL('../bin/embegrav.js', import.meta.url))
  const env = { ...process.env, EMBEGRAV_HOME: home }
  await git(cwd, ['init', '-b', 'main'])
  const child = spawn(process.execPath, [entry, '--port', '0'], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  try {
    await expect
      .poll(() => /Embegrav listening on (http:\/\/\S+)/.exec(stdout)?.[1], { timeout: 10_000 })
      .toBeTruthy()
    const origin = /Embegrav listening on (http:\/\/\S+)/.exec(stdout)![1]
    expect(stdout).not.toContain('token')
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fetch(`${origin}/api/repos`)).status).toBe(401)

    const index = await fetch(origin, { headers: { 'Accept-Encoding': 'br' } })
    expect(index.status).toBe(200)
    expect(index.headers.get('content-encoding')).toBe('br')
    expect(index.headers.get('cache-control')).toBe('no-cache')
    const html = await index.text()
    const script = /<script[^>]+src="([^"]+)"/.exec(html)![1]
    const original = await readFile(new URL(`../dist${script}`, import.meta.url), 'utf8')
    for (const encoding of ['br', 'gzip', 'identity']) {
      const asset = await fetch(`${origin}${script}`, {
        headers: { 'Accept-Encoding': encoding },
      })
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-type')).toContain('javascript')
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(asset.headers.get('content-encoding')).toBe(encoding === 'identity' ? null : encoding)
      expect(asset.headers.get('vary')).toContain('Accept-Encoding')
      expect(await asset.text()).toBe(original)
    }
    const fallback = await fetch(`${origin}/nonexistent-route`)
    expect(fallback.headers.get('cache-control')).toBe('no-cache')
    expect(await fallback.text()).toBe(html)
    expect(stdout).not.toContain('token')
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' })

    // The compiled pair command shares state with the server, without starting another listener.
    const { stdout: paired } = await run(process.execPath, [entry, 'pair'], { cwd, env })
    const token = /Pairing token: (\w+)/.exec(paired)![1]
    expect(await readdir(join(home, 'pairing'))).toHaveLength(1)
    const response = await fetch(`${origin}/api/auth/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(response.status).toBe(200)
    const { session } = (await response.json()) as { session: string }
    const repos = await fetch(`${origin}/api/repos`, {
      headers: { Authorization: `Bearer ${session}` },
    })
    expect(repos.status).toBe(200)
    expect(await repos.json()).toMatchObject({ repos: [{ path: cwd }] })
    expect(stderr).toBe('')
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    await rm(cwd, { recursive: true, force: true })
  }
})
