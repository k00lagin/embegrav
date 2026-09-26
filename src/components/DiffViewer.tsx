import { useCallback, useEffect, useMemo, useState } from 'react'
import { File, PatchDiff, type FileDiffOptions, type FileOptions } from '@pierre/diffs/react'
import type { ChangedFile } from '@shared/types'
import { api } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { shikiThemeFor } from '@/theme/vscode'
import { ChangedFilesTree } from './ChangedFilesTree'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { withWorkingFile } from './fileMenu'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconPanelRight from '~icons/lucide/panel-right'
import IconCheck from '~icons/lucide/check'
import IconX from '~icons/lucide/x'
import IconColumns2 from '~icons/lucide/columns-2'
import IconRows3 from '~icons/lucide/rows-3'
import IconWrapText from '~icons/lucide/wrap-text'
import IconLoader from '~icons/lucide/loader-circle'
import IconCircleAlert from '~icons/lucide/circle-alert'
import IconRotateCw from '~icons/lucide/rotate-cw'

export interface DiffTarget {
  file: ChangedFile
  /** Revision (hash) or pseudo revision: 'EMPTY' | 'HEAD' | 'INDEX' */
  from: string
  /** Revision (hash) or pseudo revision: 'WORKING' | 'INDEX' */
  to: string
  /** Human readable description of what is being compared */
  label: string
  /** Open a complete file instead of its patch. */
  view?: 'before' | 'after' | 'working'
  /** Other files in the same commit, comparison or staging section. */
  siblings?: DiffTarget[]
  workingComparison?: boolean
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

export function DiffViewer({
  repo,
  target: initialTarget,
  diffStyle,
  onDiffStyleChange,
  onClose,
}: Props) {
  const [selection, setSelection] = useState<{ source: DiffTarget; target: DiffTarget } | null>(
    null,
  )
  const target = selection?.source === initialTarget ? selection.target : initialTarget
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const siblings = useMemo(() => target.siblings ?? [target], [target])
  const files = useMemo(() => siblings.map((item) => item.file), [siblings])
  type View = 'diff' | NonNullable<DiffTarget['view']>
  const [viewState, setViewState] = useState<{ target: DiffTarget; view: View } | null>(null)
  const view = viewState?.target === target ? viewState.view : (target.view ?? 'diff')
  const selectFile = (file: ChangedFile) => {
    const sibling = siblings.find((item) => item.file.path === file.path)
    if (!sibling || file.path === target.file.path) return
    const next = { ...(target.workingComparison ? withWorkingFile(sibling) : sibling), siblings }
    let nextView = view
    if (nextView === 'after' && next.file.status === 'D') nextView = 'before'
    if (
      nextView === 'before' &&
      (next.from === 'EMPTY' || next.file.status === 'A' || next.file.status === '?')
    )
      nextView = 'after'
    setSelection({ source: initialTarget, target: next })
    setViewState({ target: next, view: nextView })
  }
  const filePath = view === 'before' ? (target.file.oldPath ?? target.file.path) : target.file.path
  const revision = view === 'before' ? target.from : view === 'working' ? 'WORKING' : target.to
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const [state, setState] = useState<{
    repo: string
    target: DiffTarget
    view: View
    attempt: number
    patch: string | null
    contents: string | null
    binary: boolean
    error: string | null
  } | null>(null)
  const current =
    state?.repo === repo &&
    state.target === target &&
    state.view === view &&
    state.attempt === attempt
  const patch = current ? state.patch : null
  const binary = current ? state.binary : false
  const error = current ? state.error : null
  const [wrap, setWrap] = useState(false)
  const { resolved, isLight } = useTheme()

  useEffect(() => {
    let cancelled = false
    const request =
      view === 'diff'
        ? api
            .fileDiff({
              repo,
              path: target.file.path,
              oldPath: target.file.oldPath,
              from: target.from,
              to: target.to,
              untracked: target.file.status === '?',
            })
            .then((r) => ({ patch: r.patch, binary: r.binary, contents: null }))
        : api
            .fileContent(repo, revision, filePath)
            .then((r) => ({ patch: null, binary: false, contents: r.contents }))
    void request
      .then((r) => {
        if (cancelled) return
        setState({ repo, target, view, attempt, ...r, error: null })
      })
      .catch((e: Error) => {
        if (!cancelled)
          setState({
            repo,
            target,
            view,
            attempt,
            patch: null,
            contents: null,
            binary: false,
            error: e.message,
          })
      })
    return () => {
      cancelled = true
    }
  }, [repo, target, view, revision, filePath, attempt])

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

  const fileOptions = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      theme: shikiThemeFor(resolved),
      themeType: isLight ? 'light' : 'dark',
      overflow: wrap ? 'wrap' : 'scroll',
      disableFileHeader: true,
    }),
    [resolved, isLight, wrap],
  )

  const f = target.file
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-bg"
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape' && menu) {
          e.preventDefault()
          e.stopPropagation()
          setMenu(null)
        }
      }}
    >
      <div className="flex items-center gap-3 px-3 h-9 border-b border-border bg-bg-2 shrink-0">
        <span className={`text-xs px-1.5 rounded ${statusClass(f.status)}`}>
          {STATUS_LABEL[f.status] ?? f.status}
        </span>
        <button
          type="button"
          className="min-w-0 flex items-center gap-1 rounded px-1 h-[26px] hover:bg-bg-4"
          title={filePath}
          aria-label={`Switch file (${filePath})`}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setMenu(
              menu
                ? null
                : {
                    x: rect.left,
                    y: rect.bottom,
                    searchPlaceholder: 'Search files',
                    items: siblings.map((item) => ({
                      label: item.file.path,
                      hint: item.file.status,
                      icon: item.file.path === target.file.path ? <IconCheck /> : undefined,
                      onClick: () => selectFile(item.file),
                    })),
                  },
            )
          }}
        >
          <span className="mono truncate">
            {view === 'diff' && f.oldPath && f.oldPath !== f.path ? (
              <>
                <span className="text-fg-muted">{f.oldPath}</span> → {f.path}
              </>
            ) : (
              filePath
            )}
          </span>
          <IconChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
        </button>
        <span
          className="text-fg-dim text-xs truncate"
          title={view === 'diff' ? target.label : revision}
        >
          {view === 'diff' ? target.label : revision}
        </span>
        <span className="flex-1" />
        {view === 'diff' && f.additions !== null && (
          <span className="text-xs">
            <span className="text-success">+{f.additions}</span>{' '}
            <span className="text-danger">−{f.deletions}</span>
          </span>
        )}
        <select
          aria-label="File view"
          className="shrink-0"
          value={view}
          onChange={(e) => setViewState({ target, view: e.target.value as View })}
        >
          <option value="diff">Diff</option>
          <option
            value="before"
            disabled={target.from === 'EMPTY' || f.status === 'A' || f.status === '?'}
          >
            File before change
          </option>
          <option value="after" disabled={f.status === 'D'}>
            File at this revision
          </option>
          <option value="working">Working file</option>
        </select>
        <button
          type="button"
          className={`icon-btn ${wrap ? 'bg-bg-4' : ''}`}
          title="Toggle line wrapping"
          onClick={() => setWrap((w) => !w)}
        >
          <IconWrapText className="w-4 h-4" />
        </button>
        {view === 'diff' && (
          <>
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
          </>
        )}
        <button
          type="button"
          className={`icon-btn ${sidebarOpen ? 'bg-bg-4' : ''}`}
          title={sidebarOpen ? 'Hide files sidebar' : 'Show files sidebar'}
          aria-label="Toggle files sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <IconPanelRight className="w-4 h-4" />
        </button>
        <button type="button" className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <IconX className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <div
          key={`${target.from}:${target.to}:${filePath}:${view}`}
          className="flex-1 min-w-0 overflow-auto"
          aria-busy={!current}
        >
          {!current && (
            <div className="p-4 text-fg-muted flex items-center gap-2">
              <IconLoader className="animate-spin" />{' '}
              {view === 'diff' ? 'Loading diff…' : 'Loading file…'}
            </div>
          )}
          {error !== null && (
            <div role="alert" className="w-full max-w-[540px] mx-auto my-12 px-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <IconCircleAlert className="w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
                Could not load {view === 'diff' ? 'diff' : 'file'}
              </h2>
              <p className="ml-7 mt-3 mb-4 text-fg-muted leading-relaxed">
                The {view === 'diff' ? 'diff' : 'file'} could not be retrieved. Try loading it
                again.
              </p>
              <div className="ml-7">
                <button type="button" className="btn" onClick={retry}>
                  <IconRotateCw className="w-4 h-4" aria-hidden="true" />
                  Retry
                </button>
                <details className="mt-5 pt-3 border-t border-border">
                  <summary className="w-fit cursor-pointer text-fg-muted hover:text-fg">
                    Technical details
                  </summary>
                  <pre className="mono mt-3 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words bg-bg-2 border border-border rounded-sm">
                    {error}
                    {'\n\n'}File: {filePath}
                    {'\n'}
                    {view === 'diff'
                      ? `Comparison: ${target.from} → ${target.to}`
                      : `Revision: ${revision}`}
                  </pre>
                </details>
              </div>
            </div>
          )}
          {view !== 'diff' &&
            current &&
            error === null &&
            (state.contents === null ? (
              <div className="p-4 text-fg-muted">
                File contents are not available (binary or missing).
              </div>
            ) : state.contents === '' ? (
              <div className="p-4 text-fg-muted">Empty file.</div>
            ) : (
              <File
                key={`${revision}:${filePath}`}
                file={{ name: filePath, contents: state.contents }}
                options={fileOptions}
              />
            ))}
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
        {sidebarOpen && (
          <aside
            aria-label="Files in current change"
            className="w-[320px] max-w-[45%] shrink-0 flex flex-col border-l border-border bg-bg-2"
          >
            <div className="section-header !border-t-0">
              <span>Changed files</span>
              <span className="badge">{files.length}</span>
            </div>
            <div className="flex-1 min-h-0 p-1">
              <ChangedFilesTree
                files={files}
                onOpenFile={selectFile}
                selectedPath={target.file.path}
                fillHeight
              />
            </div>
          </aside>
        )}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
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
