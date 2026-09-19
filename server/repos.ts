import { readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { RepoInfo } from '../shared/types.ts'
import { isGitRepo, repoRoot } from './git.ts'

const repos = new Map<string, RepoInfo>()

function normalize(p: string): string {
  return resolve(p).replace(/[\\/]+$/, '')
}

async function addRepoPath(p: string): Promise<RepoInfo | null> {
  const root = await repoRoot(p)
  if (!root) return null
  const key = normalize(root)
  if (!repos.has(key)) {
    repos.set(key, { path: key, name: basename(key) || key })
  }
  return repos.get(key)!
}

/**
 * Register a path: if it is a git repo, add it; otherwise add every
 * immediate subdirectory that is a git repository.
 */
export async function registerPath(p: string): Promise<RepoInfo[]> {
  const abs = normalize(p)
  try {
    const s = await stat(abs)
    if (!s.isDirectory()) return []
  } catch {
    return []
  }
  if (await isGitRepo(abs)) {
    const r = await addRepoPath(abs)
    return r ? [r] : []
  }
  const found: RepoInfo[] = []
  const entries = await readdir(abs, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(async (e) => {
        const dir = resolve(abs, e.name)
        try {
          await stat(resolve(dir, '.git'))
        } catch {
          return
        }
        const r = await addRepoPath(dir)
        if (r) found.push(r)
      }),
  )
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

export function listRepos(): RepoInfo[] {
  return [...repos.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function getRepo(path: unknown): RepoInfo {
  if (typeof path !== 'string') throw new Error('repo is required')
  const r = repos.get(normalize(path))
  if (!r) throw new Error(`Unknown repository: ${path}`)
  return r
}

export function removeRepo(path: string): void {
  repos.delete(normalize(path))
}
