import { watch, type FSWatcher } from 'node:fs'
import { git } from './git.ts'

type Listener = () => void

interface Entry {
  watcher: FSWatcher | null
  listeners: Set<Listener>
  timer: NodeJS.Timeout | null
  ready: Promise<void>
}

const entries = new Map<string, Entry>()

// Files git touches during read-only operations (or that carry no graph-relevant
// information). The builtin fsmonitor daemon in particular writes cookie files
// on every git invocation, which would otherwise create a refresh loop.
const IGNORED =
  /(^|[\\/])(index\.lock|.*\.lock|ORIG_HEAD|FETCH_HEAD|COMMIT_EDITMSG|logs[\\/]HEAD|objects[\\/]|fsmonitor--daemon([\\/]|$)|hooks[\\/]|info[\\/]|lfs[\\/])/

async function initializeWatcher(repo: string, entry: Entry): Promise<void> {
  try {
    const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim()
    const w = watch(gitDir, { recursive: true, persistent: false }, (_event, filename) => {
      const name = typeof filename === 'string' ? filename : ''
      if (name && IGNORED.test(name)) return
      if (entries.get(repo) !== entry) return
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = null
        for (const l of entry.listeners) l()
      }, 400)
    })
    w.on('error', () => {
      /* ignore watcher errors (e.g. directory removed) */
    })
    entry.watcher = w
  } catch {
    entry.watcher = null
  }
}

export async function subscribe(repo: string, listener: Listener): Promise<() => void> {
  let entry = entries.get(repo)
  if (!entry) {
    entry = { watcher: null, listeners: new Set(), timer: null, ready: Promise.resolve() }
    entries.set(repo, entry)
    entry.ready = initializeWatcher(repo, entry)
  }
  // Reserve the subscription before waiting, so cleanup cannot orphan an in-flight watcher.
  entry.listeners.add(listener)
  await entry.ready
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) {
      entry.watcher?.close()
      if (entry.timer) clearTimeout(entry.timer)
      if (entries.get(repo) === entry) entries.delete(repo)
    }
  }
}
