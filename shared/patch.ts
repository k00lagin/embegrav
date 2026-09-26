/** Split a single regular-file Git patch without changing its line endings or EOF markers. */
export function splitPatchHunks(
  patch: string,
): { heading: string; patch: string; additions: number; deletions: number }[] {
  const starts = [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@[^\n]*\n/gm)]
  // A decoded legacy-encoding patch cannot be applied losslessly through the text API.
  if (
    patch.includes('\uFFFD') ||
    starts.length === 0 ||
    (patch.match(/^diff --git /gm) ?? []).length !== 1
  )
    return []
  const header = patch.slice(0, starts[0].index)
  // Renames, copies, symlinks and submodules need whole-file operations.
  if (/^(?:rename |copy )/m.test(header) || /\b(?:120000|160000)\b/.test(header)) return []
  // Staging content must not also stage an unrelated executable-bit change.
  const contentHeader = header.replace(/^(?:old mode|new mode) \d+\n/gm, '')
  return starts.map((match, index) => {
    const body = patch.slice(match.index, starts[index + 1]?.index ?? patch.length)
    return {
      heading: match[0].trimEnd(),
      patch: contentHeader + body,
      additions: (body.match(/^\+/gm) ?? []).length,
      deletions: (body.match(/^-/gm) ?? []).length,
    }
  })
}
