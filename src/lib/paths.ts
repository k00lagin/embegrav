// Path editing helpers for the repository picker. Paths come from the server's
// OS, so Windows-style paths are detected from the text itself.

function isWindowsStyle(p: string): boolean {
  return /^[a-zA-Z]:/.test(p) || p.includes('\\')
}

export function separatorFor(p: string): '/' | '\\' {
  return isWindowsStyle(p) ? '\\' : '/'
}

function lastSeparatorIndex(p: string): number {
  return isWindowsStyle(p) ? Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) : p.lastIndexOf('/')
}

export function hasTrailingSeparator(p: string): boolean {
  return isWindowsStyle(p) ? /[\\/]$/.test(p) : p.endsWith('/')
}

/** "C:\Git\rep" -> "C:\Git\" */
export function directoryPart(p: string): string {
  if (hasTrailingSeparator(p)) return p
  const i = lastSeparatorIndex(p)
  return i < 0 ? p : p.slice(0, i + 1)
}

/** "C:\Git\rep" -> "rep" */
export function leafPart(p: string): string {
  return p.slice(lastSeparatorIndex(p) + 1)
}

/** "C:\Git\rep" + "repotree" -> "C:\Git\repotree\" */
export function childPath(p: string, name: string): string {
  return `${directoryPart(p)}${name}${separatorFor(p)}`
}

/** "C:\Git\repotree\" -> "C:\Git\"; null at a filesystem root. */
export function parentPath(p: string): string | null {
  const s = separatorFor(p)
  let trimmed = p.trim()
  while (trimmed.length > 1 && /[\\/]$/.test(trimmed) && !/^[a-zA-Z]:[\\/]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1)
  }
  if (trimmed === '/' || /^[a-zA-Z]:[\\/]?$/.test(trimmed)) return null
  const i = lastSeparatorIndex(trimmed)
  if (i < 0) return null
  if (i === 0) return '/'
  if (i === 2 && /^[a-zA-Z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}${s}`
  return `${trimmed.slice(0, i)}${s}`
}
