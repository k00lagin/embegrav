import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '../shared/types.ts'

const TRAILING_SEPARATOR = /[\\/]$/

function withTrailingSeparator(p: string): string {
  return TRAILING_SEPARATOR.test(p) ? p : p + sep
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function homeDirectory(): string {
  return withTrailingSeparator(homedir())
}

/**
 * List sub-directories for a path typed in the repository picker. A path ending
 * with a separator lists that directory; otherwise the last segment is a
 * case-insensitive name prefix within its parent ("C:\Git\re" -> "C:\Git\" filtered by "re").
 */
export async function browse(input: string): Promise<DirectoryListing> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('path is required')
  const abs = resolve(expandHome(trimmed))
  const listsDirectory = TRAILING_SEPARATOR.test(trimmed) || trimmed === '~'
  const directory = listsDirectory ? abs : dirname(abs)
  const prefix = listsDirectory ? '' : basename(abs).toLowerCase()
  // Dot-directories are clutter unless explicitly asked for.
  const showHidden = prefix.startsWith('.')

  let dirents
  try {
    dirents = await readdir(directory, { withFileTypes: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      throw new Error(`Directory not found: ${directory}`, { cause: e })
    if (code === 'EACCES' || code === 'EPERM')
      throw new Error(`Permission denied: ${directory}`, { cause: e })
    throw e
  }

  const entries: DirectoryEntry[] = await Promise.all(
    dirents
      .filter(
        (d) =>
          d.isDirectory() &&
          d.name.toLowerCase().startsWith(prefix) &&
          (showHidden || !d.name.startsWith('.')),
      )
      .map(async (d) => {
        const path = join(directory, d.name)
        const isRepo = await stat(join(path, '.git')).then(
          () => true,
          () => false,
        )
        return { name: d.name, path, isRepo }
      }),
  )
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return { directory: withTrailingSeparator(directory), entries }
}
