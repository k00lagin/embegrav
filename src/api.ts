import type { ActionArgs, ActionName } from '@shared/actions'
import type {
  ActionResult,
  CommitDetails,
  CommitStats,
  CompareDetails,
  FileDiffRequest,
  FileDiffResponse,
  GraphData,
  GraphRequest,
  RepoInfo,
  UncommittedDetails,
} from '@shared/types'

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
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
    throw new Error(msg)
  }
  return json as T
}

const post = <T>(url: string, body: unknown) => request<T>('POST', url, body)

export const api = {
  repos: () => request<{ repos: RepoInfo[] }>('GET', '/api/repos'),
  addRepo: (path: string) => post<{ repos: RepoInfo[]; added: RepoInfo[] }>('/api/repos', { path }),
  removeRepo: (path: string) => request<{ repos: RepoInfo[] }>('DELETE', '/api/repos', { path }),
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
  const es = new EventSource(`/api/events?repo=${encodeURIComponent(repo)}`)
  es.addEventListener('change', () => onChange())
  return () => es.close()
}
