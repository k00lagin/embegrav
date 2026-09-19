import { watch, type FSWatcher } from 'node:fs'
import { git } from './git.ts'

type Listener = () => void

interface Entry {
  watcher: FSWatcher | null
  listeners: Set<Listener>
  timer: NodeJS.Timeout | null
}

const entries = new Map<string, Entry>()

// Files git touches during read-only operations (or that carry no graph-relevant
// information). The builtin fsmonitor daemon in particular writes cookie files
// on every git invocation, which would otherwise create a refresh loop.
const IGNORED =
  /(^|[\\/])(index\.lock|.*\.lock|ORIG_HEAD|FETCH_HEAD|COMMIT_EDITMSG|logs[\\/]HEAD|objects[\\/]|fsmonitor--daemon([\\/]|$)|hooks[\\/]|info[\\/]|lfs[\\/])/

async function ensureWatcher(repo: string): Promise<Entry> {
  let entry = entries.get(repo)
  if (entry) return entry
  entry = { watcher: null, listeners: new Set(), timer: null }
  entries.set(repo, entry)
  try {
    const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim()
    const w = watch(gitDir, { recursive: true, persistent: false }, (_event, filename) => {
      const name = typeof filename === 'string' ? filename : ''
      if (name && IGNORED.test(name)) return
      const e = entries.get(repo)
      if (!e) return
      if (e.timer) clearTimeout(e.timer)
      e.timer = setTimeout(() => {
        e.timer = null
        for (const l of e.listeners) l()
      }, 400)
    })
    w.on('error', () => {
      /* ignore watcher errors (e.g. directory removed) */
    })
    entry.watcher = w
  } catch {
    entry.watcher = null
  }
  return entry
}

export async function subscribe(repo: string, listener: Listener): Promise<() => void> {
  const entry = await ensureWatcher(repo)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) {
      entry.watcher?.close()
      if (entry.timer) clearTimeout(entry.timer)
      entries.delete(repo)
    }
  }
}
