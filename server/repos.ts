import { readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { RepoInfo, ResolvedPath } from '../shared/types.ts'
import { git, repoRoot } from './git.ts'

const repos = new Map<string, RepoInfo>()

function normalize(p: string): string {
  return resolve(p).replace(/[\\/]+$/, '')
}

/** Resolve a working tree without registering it or scanning child directories. */
export async function findRepo(p: string): Promise<RepoInfo | null> {
  const root = await repoRoot(p)
  if (!root) return null
  const key = normalize(root)
  const existing = [...repos.values()].find((r) =>
    process.platform === 'win32' ? r.path.toLowerCase() === key.toLowerCase() : r.path === key,
  )
  return existing ?? { path: key, name: basename(key) || key }
}

async function addRepoPath(p: string): Promise<RepoInfo | null> {
  const repo = await findRepo(p)
  if (repo) repos.set(repo.path, repo)
  return repo
}

const isEmptyDirectory = (abs: string) => readdir(abs).then((entries) => entries.length === 0)

/**
 * Resolve a typed path: an enclosing repository, or whether the folder could be
 * initialized as one or receive a clone.
 */
export async function resolvePath(p: string): Promise<ResolvedPath> {
  const repo = await findRepo(p)
  if (repo) return { repo, canInit: false, canClone: false }
  const abs = normalize(p)
  try {
    if (!(await stat(abs)).isDirectory()) return { repo: null, canInit: false, canClone: false }
    return { repo: null, canInit: true, canClone: await isEmptyDirectory(abs).catch(() => false) }
  } catch {
    return { repo: null, canInit: false, canClone: false }
  }
}

async function assertDirectory(abs: string): Promise<void> {
  let isDirectory: boolean
  try {
    isDirectory = (await stat(abs)).isDirectory()
  } catch {
    throw new Error(`Directory not found: ${abs}`)
  }
  if (!isDirectory) throw new Error(`Not a directory: ${abs}`)
}

/**
 * Initialize a git repository in an existing folder and register it. The path
 * must name the folder itself: a folder inside another repository is refused
 * instead of silently creating a nested repository.
 */
export async function initRepo(p: string): Promise<RepoInfo> {
  const abs = normalize(p)
  await assertDirectory(abs)
  const existing = await findRepo(abs)
  if (existing) {
    const samePath =
      process.platform === 'win32'
        ? existing.path.toLowerCase() === abs.toLowerCase()
        : existing.path === abs
    if (!samePath) throw new Error(`${abs} is inside the repository at ${existing.path}`)
    repos.set(existing.path, existing)
    return existing
  }
  await git(abs, ['init'])
  const repo: RepoInfo = { path: abs, name: basename(abs) || abs }
  repos.set(abs, repo)
  return repo
}

/**
 * Clone into an existing empty folder with `clone` and register the result.
 * Like initRepo, a folder inside another repository is refused.
 */
export async function cloneRepo(
  p: string,
  clone: (directory: string) => Promise<unknown>,
): Promise<RepoInfo> {
  const abs = normalize(p)
  await assertDirectory(abs)
  if (!(await isEmptyDirectory(abs))) throw new Error(`${abs} is not empty`)
  const existing = await findRepo(abs)
  if (existing) throw new Error(`${abs} is inside the repository at ${existing.path}`)
  await clone(abs)
  const repo = await addRepoPath(abs)
  if (!repo) throw new Error(`No git repository found at ${abs} after cloning`)
  return repo
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
  const repo = await addRepoPath(abs)
  if (repo) return [repo]
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

export function registeredRepo(path: string): RepoInfo | undefined {
  return repos.get(normalize(path))
}

export function getRepo(path: unknown): RepoInfo {
  if (typeof path !== 'string') throw new Error('repo is required')
  const r = registeredRepo(path)
  if (!r) throw new Error(`Unknown repository: ${path}`)
  return r
}

export function removeRepo(path: string): void {
  repos.delete(normalize(path))
}
