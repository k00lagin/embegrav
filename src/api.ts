import type { ActionArgs, ActionName } from '@shared/actions'
import type {
  ActionResult,
  CommitDetails,
  CommitStats,
  CompareDetails,
  DirectoryListing,
  FileDiffRequest,
  FileDiffResponse,
  GitHubAccount,
  GraphData,
  GraphRequest,
  RepoInfo,
  UncommittedDetails,
} from '@shared/types'
import { loadLocal } from './lib/settings'

// Keep a usable session in this tab when browser storage is unavailable or full.
let volatileSession: string | null | undefined

/** The browser's session token, issued by the server in exchange for a pairing token. */
export function getSession(): string | null {
  if (volatileSession !== undefined) return volatileSession
  return loadLocal(
    'session',
    null,
    (value): value is string | null => value === null || typeof value === 'string',
  )
}

export function setSession(session: string | null): void {
  try {
    localStorage.setItem('embegrav.session', JSON.stringify(session))
    volatileSession = undefined
  } catch {
    volatileSession = session
  }
}

/** The server rejected the request because this browser is not paired. */
export class UnauthorizedError extends Error {}

const unauthorizedListeners = new Set<() => void>()

/** Called whenever an API request is rejected for a missing or revoked session. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const session = getSession()
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (session) headers.authorization = `Bearer ${session}`
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : text || res.statusText
    if (res.status === 401) {
      // A rejected pairing token is reported to the caller, not as a lost session.
      if (url !== PAIR_URL && session === getSession()) {
        for (const listener of unauthorizedListeners) listener()
      }
      throw new UnauthorizedError(msg)
    }
    throw new Error(msg)
  }
  return json as T
}

const post = <T>(url: string, body: unknown) => request<T>('POST', url, body)

const PAIR_URL = '/api/auth/pair'

export const api = {
  /** Trade a single-use pairing token for a session token. */
  pair: (token: string) => post<{ session: string }>(PAIR_URL, { token }),
  /** Resolves when the stored session is accepted by the server. */
  checkSession: () => post<{ ok: true }>('/api/auth/session', {}),
  repos: () => request<{ repos: RepoInfo[] }>('GET', '/api/repos'),
  capabilities: () => request<{ revealInFileExplorer: boolean }>('GET', '/api/capabilities'),
  addRepo: (path: string) => post<{ repos: RepoInfo[]; added: RepoInfo[] }>('/api/repos', { path }),
  removeRepo: (path: string) => request<{ repos: RepoInfo[] }>('DELETE', '/api/repos', { path }),
  revealRepo: (path: string, filePath?: string) =>
    post<{ ok: true }>('/api/repos/reveal', { path, filePath }),
  browse: (path: string) =>
    request<DirectoryListing>('GET', `/api/browse?path=${encodeURIComponent(path)}`),
  browseHome: () => request<{ path: string }>('GET', '/api/browse/home'),
  /** The GitHub CLI account used to publish repositories (fails when gh is missing or signed out). */
  githubAccount: () => request<GitHubAccount>('GET', '/api/github/account'),
  graph: (req: GraphRequest) => post<GraphData>('/api/graph', req),
  commit: (repo: string, hash: string) => post<CommitDetails>('/api/commit', { repo, hash }),
  uncommitted: (repo: string) => post<UncommittedDetails>('/api/uncommitted', { repo }),
  stats: (repo: string, hashes: string[]) =>
    post<{ stats: Record<string, CommitStats> }>('/api/stats', { repo, hashes }),
  compare: (repo: string, from: string, to: string) =>
    post<CompareDetails>('/api/compare', { repo, from, to }),
  fileDiff: (req: FileDiffRequest) => post<FileDiffResponse>('/api/file-diff', req),
  fileContent: (repo: string, rev: string, path: string) =>
    post<{ contents: string | null }>('/api/file-content', { repo, rev, path }),
  action: <K extends ActionName>(repo: string, action: K, args: ActionArgs[K]) =>
    post<ActionResult>('/api/action', { repo, action, args }),
}

/** Subscribe to repository change events (server-sent events). */
export function subscribeRepoEvents(repo: string, onChange: () => void): () => void {
  // EventSource cannot send an Authorization header.
  const params = new URLSearchParams({ repo, session: getSession() ?? '' })
  const es = new EventSource(`/api/events?${params}`)
  es.addEventListener('change', () => onChange())
  return () => es.close()
}
