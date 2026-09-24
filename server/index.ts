import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { FileDiffRequest, GraphRequest } from '../shared/types.ts'
import { decodeActionRequest } from '../shared/actions.ts'
import { runAction } from './actions.ts'
import { GitError } from './git.ts'
import {
  getCommitDetails,
  getCommitStats,
  getCompare,
  getFileContent,
  getFileDiff,
  getGraph,
  getUncommittedDetails,
} from './repo.ts'
import { getRepo, listRepos, registerPath, removeRepo } from './repos.ts'
import { subscribe } from './watcher.ts'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  paths: string[]
  port: number
  host: string
  open: boolean
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { paths: [], port: 3210, host: '127.0.0.1', open: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port' || a === '-p') cli.port = Number(argv[++i])
    else if (a.startsWith('--port=')) cli.port = Number(a.slice(7))
    else if (a === '--host') cli.host = argv[++i]
    else if (a === '--open' || a === '-o') cli.open = true
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: embegrav [options] [path ...]

Opens a Git Graph style web UI for the given repositories (default: current directory).
If a path is not a repository, its immediate sub-directories are scanned for repositories.

Options:
  -p, --port <n>   Port to listen on (default 3210)
      --host <h>   Host to bind (default 127.0.0.1)
  -o, --open       Open the UI in the default browser
  -h, --help       Show this help`)
      process.exit(0)
    } else cli.paths.push(a)
  }
  if (cli.paths.length === 0) cli.paths.push(process.cwd())
  return cli
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const api = new Hono()

api.onError((err, c) => {
  const status = err instanceof GitError ? 422 : 400
  return c.json(
    { error: err.message, code: err instanceof GitError ? err.code : undefined },
    status,
  )
})

api.get('/repos', (c) => c.json({ repos: listRepos() }))

api.post('/repos', async (c) => {
  const body = (await c.req.json()) as { path?: string }
  if (!body.path) return c.json({ error: 'path is required' }, 400)
  const added = await registerPath(body.path)
  if (added.length === 0) return c.json({ error: `No git repository found at ${body.path}` }, 404)
  return c.json({ repos: listRepos(), added })
})

api.delete('/repos', async (c) => {
  const body = (await c.req.json()) as { path?: string }
  if (body.path) removeRepo(body.path)
  return c.json({ repos: listRepos() })
})

api.post('/graph', async (c) => {
  const body = (await c.req.json()) as GraphRequest
  const repo = getRepo(body.repo)
  const data = await getGraph({
    repo: repo.path,
    maxCommits: Math.min(Math.max(Number(body.maxCommits) || 300, 1), 50_000),
    showRemoteBranches: body.showRemoteBranches !== false,
    branches: Array.isArray(body.branches)
      ? body.branches.filter((b) => typeof b === 'string')
      : null,
    order: body.order === 'topo' || body.order === 'author-date' ? body.order : 'date',
    showStashes: body.showStashes !== false,
    showTags: body.showTags !== false,
  })
  return c.json(data)
})

api.post('/commit', async (c) => {
  const body = (await c.req.json()) as { repo: string; hash: string }
  const repo = getRepo(body.repo)
  return c.json(await getCommitDetails(repo.path, body.hash))
})

api.post('/stats', async (c) => {
  const body = (await c.req.json()) as { repo: string; hashes: string[] }
  const repo = getRepo(body.repo)
  const hashes = Array.isArray(body.hashes)
    ? body.hashes.filter((h) => typeof h === 'string').slice(0, 5000)
    : []
  return c.json({ stats: await getCommitStats(repo.path, hashes) })
})

api.post('/uncommitted', async (c) => {
  const body = (await c.req.json()) as { repo: string }
  const repo = getRepo(body.repo)
  return c.json(await getUncommittedDetails(repo.path))
})

api.post('/compare', async (c) => {
  const body = (await c.req.json()) as { repo: string; from: string; to: string }
  const repo = getRepo(body.repo)
  return c.json(await getCompare(repo.path, body.from, body.to))
})

api.post('/file-diff', async (c) => {
  const body = (await c.req.json()) as FileDiffRequest
  const repo = getRepo(body.repo)
  return c.json(await getFileDiff({ ...body, repo: repo.path }))
})

api.post('/file-content', async (c) => {
  const body = (await c.req.json()) as { repo: string; rev: string; path: string }
  const repo = getRepo(body.repo)
  const contents = await getFileContent(repo.path, body.rev, body.path)
  return c.json({ contents })
})

api.post('/action', async (c) => {
  const body = decodeActionRequest(await c.req.json())
  const repo = getRepo(body.repo)
  const { output, undo } = await runAction(repo.path, body.action, body.args)
  return c.json({ ok: true, output, undo })
})

api.get('/events', async (c) => {
  const repoPath = c.req.query('repo')
  const repo = getRepo(repoPath)
  return streamSSE(c, async (stream) => {
    const unsubscribe = await subscribe(repo.path, () => {
      void stream.writeSSE({ event: 'change', data: repo.path })
    })
    stream.onAbort(unsubscribe)
    try {
      // onAbort does not replay an abort that happened while the watcher initialized.
      if (stream.aborted) return
      await stream.writeSSE({ event: 'ready', data: repo.path })
      while (!stream.aborted) {
        await stream.sleep(15_000)
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    } finally {
      unsubscribe()
    }
  })
})

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono()
app.route('/api', api)

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(packageRoot, 'dist')
const hasDist = existsSync(join(distDir, 'index.html'))
if (hasDist) {
  const root = relative(process.cwd(), distDir) || '.'
  app.use('/*', serveStatic({ root }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
} else {
  app.get('/', (c) =>
    c.text(
      'Embegrav server is running. The web client has not been built yet: run "pnpm build" (or use "pnpm dev" for the Vite dev server on http://localhost:5173).',
    ),
  )
}

async function main() {
  const cli = parseArgs(process.argv.slice(2))
  for (const p of cli.paths) {
    const found = await registerPath(p)
    if (found.length === 0) console.warn(`No git repository found at ${p}`)
  }
  const repos = listRepos()
  serve({ fetch: app.fetch, port: cli.port, hostname: cli.host }, (info) => {
    const url = `http://${cli.host === '0.0.0.0' ? 'localhost' : cli.host}:${info.port}`
    console.log(`Embegrav listening on ${url}`)
    console.log(
      `Repositories (${repos.length}): ${repos.map((r) => r.path).join(', ') || '(none)'}`,
    )
    if (cli.open && hasDist) openBrowser(url)
  })
}

function openBrowser(url: string) {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (error) => console.warn(`Could not open browser: ${error.message}`))
    child.unref()
  } catch {
    /* ignore */
  }
}

void main()
