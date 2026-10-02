import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { FileDiffRequest, GraphRequest } from '../shared/types.ts'
import { decodeActionRequest } from '../shared/actions.ts'
import { runAction } from './actions.ts'
import {
  DEFAULT_PAIRING_TTL_MS,
  bearerToken,
  createPairingToken,
  isValidSession,
  redeemPairingToken,
} from './auth.ts'
import { browse, homeDirectory } from './browse.ts'
import { GitError } from './git.ts'
import { getGitHubAccount } from './github.ts'
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
import { revealInFileExplorer, workingRevealPath } from './explorer.ts'
import { isLocalRequest } from './local.ts'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  command: 'serve' | 'pair'
  paths: string[]
  port: number
  host: string
  open: boolean
  /** Pairing token lifetime in minutes (`pair` only) */
  ttl: number
  /** Repository to open through the pairing link (`pair` only) */
  repo: string | null
}

const HELP = `Usage: embegrav [options] [path ...]
       embegrav pair [--repo <path>] [--ttl <minutes>] [--port <n>] [--host <h>]

Opens a Git Graph style web UI for the given repositories (default: current directory).
If a path is not a repository, its immediate sub-directories are scanned for repositories.

The API only answers paired browsers. "embegrav pair" prints a single-use pairing
link; opening it stores a session in the browser. The server prints (and with
--open, opens) such a link on startup. Links may carry ?repo=<path> to open a
repository; paired browsers can open http://host:port/?repo=<path> directly.

Options:
  -p, --port <n>      Port to listen on / to put in the link (default 3210)
      --host <h>      Host to bind / to put in the link (default 127.0.0.1)
  -o, --open          Open the UI in the default browser
                      (pair: open the pairing link)
      --repo <path>   pair: repository to open with the link
      --ttl <min>     pair: token lifetime in minutes (default 5)
  -h, --help          Show this help

Pairing tokens and sessions are stored in ~/.embegrav (override with EMBEGRAV_HOME);
delete files in its sessions/ folder to revoke browsers.`

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    command: 'serve',
    paths: [],
    port: 3210,
    host: '127.0.0.1',
    open: false,
    ttl: DEFAULT_PAIRING_TTL_MS / 60_000,
    repo: null,
  }
  if (argv[0] === 'pair') {
    cli.command = 'pair'
    argv = argv.slice(1)
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port' || a === '-p') cli.port = Number(argv[++i])
    else if (a.startsWith('--port=')) cli.port = Number(a.slice(7))
    else if (a === '--host') cli.host = argv[++i]
    else if (a === '--open' || a === '-o') cli.open = true
    else if (a === '--repo') cli.repo = argv[++i] ?? null
    else if (a === '--ttl') cli.ttl = Number(argv[++i])
    else if (a === '--help' || a === '-h') {
      console.log(HELP)
      process.exit(0)
    } else cli.paths.push(a)
  }
  if (!(cli.ttl > 0)) {
    console.error('--ttl must be a positive number of minutes')
    process.exit(1)
  }
  if (cli.paths.length === 0) cli.paths.push(process.cwd())
  return cli
}

function serverUrl(host: string, port: number): string {
  const hostname = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  const authority = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
  return `http://${authority}:${port}`
}

function pairingUrl(host: string, port: number, token: string, repo: string | null): string {
  const url = new URL(serverUrl(host, port))
  if (repo) url.searchParams.set('repo', repo)
  // The fragment is never sent to the server, so the token stays out of request lines and logs.
  url.hash = new URLSearchParams({ token }).toString()
  return url.toString()
}

function formatExpiry(expiresAt: number): string {
  const minutes = Math.round((expiresAt - Date.now()) / 60_000)
  return `single use, expires in ${minutes} min`
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

// The only unauthenticated endpoint: trade a pairing token for a session.
api.post('/auth/pair', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null
  const session = await redeemPairingToken(body?.token, c.req.header('user-agent'))
  if (!session) {
    return c.json(
      { error: 'The pairing token is invalid, expired or already used', code: 'unauthorized' },
      401,
    )
  }
  return c.json({ session })
})

api.use('*', async (c, next) => {
  // EventSource cannot send headers, so the event stream takes the session as a query parameter.
  const session =
    bearerToken(c.req.header('authorization')) ??
    (c.req.path === '/api/events' ? c.req.query('session') : undefined)
  if (!(await isValidSession(session))) {
    return c.json(
      { error: 'This browser is not paired with the server', code: 'unauthorized' },
      401,
    )
  }
  await next()
})

api.post('/auth/session', (c) => c.json({ ok: true }))

api.get('/repos', (c) => c.json({ repos: listRepos() }))

api.get('/capabilities', (c) => c.json({ revealInFileExplorer: isLocalRequest(c) }))

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

api.post('/repos/reveal', async (c) => {
  if (!isLocalRequest(c)) {
    return c.json(
      { error: 'Reveal in File Explorer is only available on the server computer' },
      403,
    )
  }
  const body = (await c.req.json()) as { path?: unknown; filePath?: unknown }
  const repo = getRepo(body.path)
  const target =
    body.filePath === undefined ? repo.path : await workingRevealPath(repo.path, body.filePath)
  await revealInFileExplorer(target)
  return c.json({ ok: true })
})

api.get('/github/account', async (c) => c.json(await getGitHubAccount()))

api.get('/browse', async (c) => c.json(await browse(c.req.query('path') ?? '')))

api.get('/browse/home', (c) => c.json({ path: homeDirectory() }))

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

async function pair(cli: Cli) {
  const repo = cli.repo && resolve(cli.repo)
  const { token, expiresAt } = await createPairingToken(cli.ttl * 60_000)
  console.log(`Pairing token: ${token} (${formatExpiry(expiresAt)})`)
  const link = pairingUrl(cli.host, cli.port, token, repo)
  console.log(`Open: ${link}`)
  if (cli.open) openBrowser(link)
}

async function main() {
  const cli = parseArgs(process.argv.slice(2))
  if (cli.command === 'pair') return pair(cli)
  for (const p of cli.paths) {
    const found = await registerPath(p)
    if (found.length === 0) console.warn(`No git repository found at ${p}`)
  }
  const repos = listRepos()
  serve({ fetch: app.fetch, port: cli.port, hostname: cli.host }, (info) => {
    const url = serverUrl(cli.host, info.port)
    console.log(`Embegrav listening on ${url}`)
    console.log(
      `Repositories (${repos.length}): ${repos.map((r) => r.path).join(', ') || '(none)'}`,
    )
    createPairingToken().then(
      ({ token, expiresAt }) => {
        const link = pairingUrl(cli.host, info.port, token, null)
        console.log(`Pair a browser: ${link} (${formatExpiry(expiresAt)})`)
        if (cli.open && hasDist) openBrowser(link)
      },
      (error: Error) => {
        console.warn(`Could not create a pairing token: ${error.message}`)
        if (cli.open && hasDist) openBrowser(url)
      },
    )
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
