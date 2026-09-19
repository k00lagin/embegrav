import { useEffect, useMemo, useState } from 'react'
import { PatchDiff, type FileDiffOptions } from '@pierre/diffs/react'
import type { ChangedFile } from '@shared/types'
import { api } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { shikiThemeFor } from '@/theme/vscode'
import IconX from '~icons/lucide/x'
import IconColumns2 from '~icons/lucide/columns-2'
import IconRows3 from '~icons/lucide/rows-3'
import IconWrapText from '~icons/lucide/wrap-text'
import IconLoader from '~icons/lucide/loader-circle'

export interface DiffTarget {
  file: ChangedFile
  /** Revision (hash) or pseudo revision: 'EMPTY' | 'HEAD' | 'INDEX' */
  from: string
  /** Revision (hash) or pseudo revision: 'WORKING' | 'INDEX' */
  to: string
  /** Human readable description of what is being compared */
  label: string
}

interface Props {
  repo: string
  target: DiffTarget
  diffStyle: 'unified' | 'split'
  onDiffStyleChange: (s: 'unified' | 'split') => void
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Conflict',
  '?': 'Untracked',
}

export function DiffViewer({ repo, target, diffStyle, onDiffStyleChange, onClose }: Props) {
  const [patch, setPatch] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wrap, setWrap] = useState(false)
  const { resolved, isLight } = useTheme()

  useEffect(() => {
    let cancelled = false
    api
      .fileDiff({
        repo,
        path: target.file.path,
        oldPath: target.file.oldPath,
        from: target.from,
        to: target.to,
        untracked: target.file.status === '?',
      })
      .then((r) => {
        if (cancelled) return
        setPatch(r.patch)
        setBinary(r.binary)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [repo, target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: shikiThemeFor(resolved),
      themeType: isLight ? 'light' : 'dark',
      diffStyle,
      overflow: wrap ? 'wrap' : 'scroll',
      disableFileHeader: true,
      lineDiffType: 'word',
      loadDiffFiles: async (fileDiff) => {
        const [oldRes, newRes] = await Promise.all([
          api.fileContent(repo, target.from, fileDiff.prevName ?? fileDiff.name),
          api.fileContent(repo, target.to, fileDiff.name),
        ])
        if (oldRes.contents === null || newRes.contents === null) {
          throw new Error('File contents are not available (binary or missing)')
        }
        return {
          oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: oldRes.contents },
          newFile: { name: fileDiff.name, contents: newRes.contents },
        }
      },
    }),
    [diffStyle, wrap, repo, target, resolved, isLight],
  )

  const f = target.file
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg">
      <div className="flex items-center gap-3 px-3 h-9 border-b border-border bg-bg-2 shrink-0">
        <span className={`text-xs px-1.5 rounded ${statusClass(f.status)}`}>
          {STATUS_LABEL[f.status] ?? f.status}
        </span>
        <span className="mono truncate">
          {f.oldPath && f.oldPath !== f.path ? (
            <>
              <span className="text-fg-muted">{f.oldPath}</span> → {f.path}
            </>
          ) : (
            f.path
          )}
        </span>
        <span className="text-fg-dim text-xs truncate">{target.label}</span>
        <span className="flex-1" />
        {f.additions !== null && (
          <span className="text-xs">
            <span className="text-success">+{f.additions}</span>{' '}
            <span className="text-danger">−{f.deletions}</span>
          </span>
        )}
        <button
          type="button"
          className={`icon-btn ${wrap ? 'bg-bg-4' : ''}`}
          title="Toggle line wrapping"
          onClick={() => setWrap((w) => !w)}
        >
          <IconWrapText className="w-4 h-4" />
        </button>
        <button
          type="button"
          className={`icon-btn ${diffStyle === 'unified' ? 'bg-bg-4' : ''}`}
          title="Unified view"
          onClick={() => onDiffStyleChange('unified')}
        >
          <IconRows3 className="w-4 h-4" />
        </button>
        <button
          type="button"
          className={`icon-btn ${diffStyle === 'split' ? 'bg-bg-4' : ''}`}
          title="Split view"
          onClick={() => onDiffStyleChange('split')}
        >
          <IconColumns2 className="w-4 h-4" />
        </button>
        <button type="button" className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <IconX className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {error && <div className="p-4 text-danger whitespace-pre-wrap">{error}</div>}
        {!error && patch === null && (
          <div className="p-4 text-fg-muted flex items-center gap-2">
            <IconLoader className="animate-spin" /> Loading diff…
          </div>
        )}
        {patch !== null && binary && (
          <div className="p-4 text-fg-muted">Binary file — no textual diff available.</div>
        )}
        {patch !== null && !binary && patch.trim() === '' && (
          <div className="p-4 text-fg-muted">
            No textual changes (mode change or identical content).
          </div>
        )}
        {patch !== null && !binary && patch.trim() !== '' && (
          <PatchDiff
            key={`${target.from}:${target.to}:${f.path}:${diffStyle}`}
            patch={patch}
            options={options}
          />
        )}
      </div>
    </div>
  )
}

export function statusClass(status: string): string {
  switch (status) {
    case 'A':
    case '?':
      return 'bg-success/20 text-success'
    case 'D':
      return 'bg-danger/20 text-danger'
    case 'R':
    case 'C':
      return 'bg-link/20 text-link'
    case 'U':
      return 'bg-warning/20 text-warning'
    default:
      return 'bg-warning/15 text-warning'
  }
}
