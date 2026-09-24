import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangedFile,
  CommitDetails as CommitDetailsData,
  CompareDetails,
  GraphData,
  UncommittedDetails,
} from '@shared/types'
import { api } from '@/api'
import { formatFullDate, shortHash } from '@/lib/format'
import { loadLocal, saveLocal } from '@/lib/settings'
import type { RepoActions } from '@/hooks/useRepoActions'
import { useErrorToast } from '@/hooks/useErrorToast'
import { ChangedFilesTree, type RowAction } from './ChangedFilesTree'
import type { DiffTarget } from './DiffViewer'
import type { MenuEntry } from './ContextMenu'
import { useDialog } from './Dialog'
import { Dropdown, DropdownItem } from './Dropdown'
import IconX from '~icons/lucide/x'
import IconCopy from '~icons/lucide/copy'
import IconPlus from '~icons/lucide/plus'
import IconMinus from '~icons/lucide/minus'
import IconEraser from '~icons/lucide/eraser'
import IconArchive from '~icons/lucide/archive'
import IconFileDiff from '~icons/lucide/file-diff'
import IconLoader from '~icons/lucide/loader-circle'
import IconGitCommit from '~icons/lucide/git-commit-horizontal'
import IconUndo2 from '~icons/lucide/undo-2'
import IconHistory from '~icons/lucide/history'

export type DetailsMode =
  | { kind: 'commit'; hash: string }
  | { kind: 'uncommitted' }
  | { kind: 'compare'; from: string; to: string }

/** row = info beside the file tree (inline expansion); column = info above the file tree (side panel) */
export type DetailsLayout = 'row' | 'column'

interface Props {
  repo: string
  mode: DetailsMode
  data: GraphData
  /** Bumped whenever the graph reloads, so details refresh too */
  version: number
  actions: RepoActions
  layout?: DetailsLayout
  onOpenDiff: (target: DiffTarget) => void
  onSelectCommit: (hash: string) => void
  onClose: () => void
}

export function CommitDetails(props: Props) {
  const { mode, layout = 'row' } = props
  return (
    <div className="relative">
      {layout === 'row' && (
        <button
          type="button"
          className="icon-btn absolute top-1 right-1 z-10"
          title="Close details"
          onClick={props.onClose}
        >
          <IconX className="w-4 h-4" />
        </button>
      )}
      {mode.kind === 'commit' && (
        <CommitView
          key={`${props.repo}:${mode.hash}`}
          {...props}
          layout={layout}
          hash={mode.hash}
        />
      )}
      {mode.kind === 'uncommitted' && (
        <UncommittedView key={props.repo} {...props} layout={layout} />
      )}
      {mode.kind === 'compare' && (
        <CompareView
          key={`${props.repo}:${mode.from}..${mode.to}`}
          {...props}
          layout={layout}
          from={mode.from}
          to={mode.to}
        />
      )}
    </div>
  )
}

/** Shared class names for the two layouts. */
function layoutClasses(layout: DetailsLayout) {
  return layout === 'column'
    ? {
        wrap: 'flex flex-col',
        info: 'p-3 border-b border-border',
        files: 'flex-1 min-w-0 flex flex-col',
        header: 'section-header !border-t-0',
        treeRows: 40,
      }
    : {
        wrap: 'flex min-h-[140px]',
        info: 'w-[420px] shrink-0 p-3 border-r border-border overflow-x-hidden',
        files: 'flex-1 min-w-0 flex flex-col',
        header: 'section-header !border-t-0 pr-8',
        treeRows: 16,
      }
}

function useLoader<T>(load: () => Promise<T>, version: number, title: string) {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const [state, setState] = useState<{
    load: typeof load
    version: number
    attempt: number
    data: T | null
    error: string | null
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    void load()
      .then((data) => !cancelled && setState({ load, version, attempt, data, error: null }))
      .catch(
        (e: Error) =>
          !cancelled && setState({ load, version, attempt, data: null, error: e.message }),
      )
    return () => {
      cancelled = true
    }
  }, [load, version, attempt])
  // Keep the current view mounted during background refreshes so text entry,
  // focus, and tree expansion survive. A new resource identity starts empty.
  const current = state?.load === load && state.version === version && state.attempt === attempt
  useErrorToast(current ? state.error : null, title, retry)
  return state?.load === load
    ? { data: state.data, error: current ? state.error : null, current }
    : { data: null, error: null, current: false }
}

function Loading() {
  return (
    <div className="p-3 text-fg-muted flex items-center gap-2">
      <IconLoader className="animate-spin" /> Loading…
    </div>
  )
}

function Person({ name, email }: { name: string; email: string }) {
  return (
    <span>
      {name} {email && <span className="text-fg-muted">&lt;{email}&gt;</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------

function CommitView({
  repo,
  hash,
  data,
  version,
  actions,
  onOpenDiff,
  onSelectCommit,
  layout,
}: Props & { hash: string; layout: DetailsLayout }) {
  const load = useCallback(() => api.commit(repo, hash), [repo, hash])
  const state = useLoader<CommitDetailsData>(load, version, 'Could not load commit details')
  const d = state.data
  const refsHere = useMemo(() => data.refs.filter((r) => r.hash === hash), [data.refs, hash])
  const cls = layoutClasses(layout)
  if (state.error) return null
  if (!d) return <Loading />
  const from = d.parents[0] ?? 'EMPTY'
  return (
    <div className={cls.wrap}>
      <div className={cls.info}>
        <table className="kv-table">
          <tbody>
            <tr>
              <td>Commit</td>
              <td className="mono">
                {d.hash}{' '}
                <button
                  type="button"
                  className="icon-btn !w-5 !h-5 align-middle"
                  title="Copy hash"
                  onClick={() => void actions.copy(d.hash, 'Commit hash')}
                >
                  <IconCopy className="w-3 h-3" />
                </button>
              </td>
            </tr>
            <tr>
              <td>Parents</td>
              <td className="mono">
                {d.parents.length === 0 && <span className="text-fg-dim">(root commit)</span>}
                {d.parents.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="text-link hover:underline mr-2"
                    onClick={() => onSelectCommit(p)}
                    title="Select parent commit"
                  >
                    {shortHash(p)}
                  </button>
                ))}
              </td>
            </tr>
            <tr>
              <td>Author</td>
              <td>
                <Person name={d.author} email={d.email} />
              </td>
            </tr>
            <tr>
              <td>Date</td>
              <td>{formatFullDate(d.date)}</td>
            </tr>
            {(d.committer !== d.author ||
              d.committerEmail !== d.email ||
              d.commitDate !== d.date) && (
              <>
                <tr>
                  <td>Committer</td>
                  <td>
                    <Person name={d.committer} email={d.committerEmail} />
                  </td>
                </tr>
                <tr>
                  <td>Commit date</td>
                  <td>{formatFullDate(d.commitDate)}</td>
                </tr>
              </>
            )}
            {refsHere.length > 0 && (
              <tr>
                <td>Refs</td>
                <td className="whitespace-normal">
                  {refsHere.map((r) => (
                    <span key={r.type + r.name} className="badge mr-1 mb-1 font-normal">
                      {r.name}
                    </span>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-2 whitespace-pre-wrap break-words">
          <div className="font-semibold">{d.subject}</div>
          {d.body && <div className="mt-1 text-fg-muted">{d.body}</div>}
        </div>
      </div>
      <div className={cls.files}>
        <div className={cls.header}>
          <IconFileDiff className="w-3.5 h-3.5" />
          <span>Changed files</span>
          <span className="badge">{d.files.length}</span>
        </div>
        <div className="p-1">
          <ChangedFilesTree
            files={d.files}
            maxRows={cls.treeRows}
            emptyText="No file changes in this commit"
            onOpenFile={(file) =>
              onOpenDiff({
                file,
                from,
                to: d.hash,
                label: `${shortHash(from)} → ${shortHash(d.hash)}`,
              })
            }
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function CompareView({
  repo,
  from,
  to,
  version,
  onOpenDiff,
  layout,
}: Props & { from: string; to: string; layout: DetailsLayout }) {
  const load = useCallback(() => api.compare(repo, from, to), [repo, from, to])
  const state = useLoader<CompareDetails>(load, version, 'Could not compare commits')
  const cls = layoutClasses(layout)
  if (state.error) return null
  if (!state.data) return <Loading />
  const files = state.data.files
  return (
    <div className={cls.wrap}>
      <div className={cls.info}>
        <div className="font-semibold mb-1">Comparing commits</div>
        <table className="kv-table">
          <tbody>
            <tr>
              <td>From</td>
              <td className="mono">{from}</td>
            </tr>
            <tr>
              <td>To</td>
              <td className="mono">{to}</td>
            </tr>
          </tbody>
        </table>
        <div className="text-fg-dim text-xs mt-2">
          Ctrl/Cmd+click another commit to change the comparison, or click a commit to select it
          alone.
        </div>
      </div>
      <div className={cls.files}>
        <div className={cls.header}>
          <IconFileDiff className="w-3.5 h-3.5" />
          <span>Changed files</span>
          <span className="badge">{files.length}</span>
        </div>
        <div className="p-1">
          <ChangedFilesTree
            files={files}
            maxRows={cls.treeRows}
            emptyText="No differences"
            onOpenFile={(file) =>
              onOpenDiff({ file, from, to, label: `${shortHash(from)} → ${shortHash(to)}` })
            }
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function UncommittedView({
  repo,
  data,
  version,
  actions,
  onOpenDiff,
  layout,
}: Props & { layout: DetailsLayout }) {
  const load = useCallback(() => api.uncommitted(repo), [repo])
  const state = useLoader<UncommittedDetails>(load, version, 'Could not load uncommitted changes')
  const cls = layoutClasses(layout)
  const treeRows = layout === 'column' ? 20 : 10
  const dialog = useDialog()
  const draftKey = `commitDraft:${repo}`
  const historyKey = `commitHistory:${repo}`
  const [message, setMessage] = useState(() => loadLocal(draftKey, '', isString))
  const [history, setHistory] = useState(() => loadLocal(historyKey, [], isStringList))
  const [amend, setAmendState] = useState(false)
  const amendRef = useRef(false)
  // The message typed before Amend replaced it with the previous commit's message
  const draftBeforeAmend = useRef('')
  const prefilled = useRef<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const commitInFlight = useRef(false)
  const d = state.data
  const busy =
    data.state.mergeInProgress ||
    data.state.rebaseInProgress ||
    data.state.cherryPickInProgress ||
    data.state.revertInProgress

  // The draft survives reloads and repository switches; amend text is not a draft.
  useEffect(() => {
    if (!amend) saveLocal(draftKey, message)
  }, [draftKey, message, amend])

  const setAmend = async (on: boolean) => {
    amendRef.current = on
    setAmendState(on)
    if (!on) {
      if (prefilled.current !== null && message === prefilled.current)
        setMessage(draftBeforeAmend.current)
      prefilled.current = null
      return
    }
    draftBeforeAmend.current = message
    if (!data.head) return
    try {
      const last = await api.commit(repo, data.head)
      const text = last.body ? `${last.subject}\n\n${last.body}` : last.subject
      // Leave the text alone if the user started typing or unchecked Amend meanwhile.
      setMessage((m) => {
        if (!amendRef.current || m !== draftBeforeAmend.current) return m
        prefilled.current = text
        return text
      })
    } catch {
      // Without the previous message the placeholder still explains that it is kept.
    }
  }

  const canCommit =
    state.current &&
    !!d &&
    !committing &&
    !busy &&
    (!!message.trim() || amend) &&
    (d.staged.length > 0 || amend)
  const commit = async () => {
    if (!canCommit || commitInFlight.current) return
    commitInFlight.current = true
    setCommitting(true)
    try {
      const ok = await actions.run(
        'Commit',
        'commit',
        { message, amend },
        { successMessage: amend ? 'Commit amended' : 'Committed' },
      )
      if (ok) {
        const text = message.trim()
        if (text) {
          const next = [text, ...history.filter((h) => h !== text)].slice(0, 20)
          setHistory(next)
          saveLocal(historyKey, next)
        }
        if (amend) {
          amendRef.current = false
          setAmendState(false)
          prefilled.current = null
          setMessage(draftBeforeAmend.current)
        } else setMessage('')
      }
    } finally {
      commitInFlight.current = false
      setCommitting(false)
    }
  }

  const openStaged = (file: ChangedFile) =>
    onOpenDiff({
      file,
      from: data.head ? 'HEAD' : 'EMPTY',
      to: 'INDEX',
      label: 'HEAD → Index (staged)',
    })
  const openUnstaged = (file: ChangedFile) =>
    onOpenDiff({
      file,
      from: file.status === '?' ? 'HEAD' : 'INDEX',
      to: 'WORKING',
      label: file.status === '?' ? 'Untracked file' : 'Index → Working tree (unstaged)',
    })

  const stagedMenu = (file: ChangedFile | undefined, path: string, isDir: boolean): MenuEntry[] => [
    ...(file
      ? [
          { label: 'Open Diff', icon: <IconFileDiff />, onClick: () => openStaged(file) },
          'separator' as const,
        ]
      : []),
    {
      label: isDir ? 'Unstage Folder' : 'Unstage',
      icon: <IconMinus />,
      onClick: () => unstage(path),
    },
    {
      label: isDir ? 'Discard Folder Changes…' : 'Discard Changes…',
      icon: <IconEraser />,
      danger: true,
      onClick: () => void discard(path),
    },
    'separator',
    { label: 'Copy Path', icon: <IconCopy />, onClick: () => void actions.copy(path, 'Path') },
  ]
  const unstagedMenu = (
    file: ChangedFile | undefined,
    path: string,
    isDir: boolean,
  ): MenuEntry[] => [
    ...(file
      ? [
          { label: 'Open Diff', icon: <IconFileDiff />, onClick: () => openUnstaged(file) },
          'separator' as const,
        ]
      : []),
    {
      label: isDir ? 'Stage Folder' : 'Stage',
      icon: <IconPlus />,
      onClick: () => stage(path),
    },
    ...(file?.status === 'U'
      ? [
          {
            label: 'Resolve using Ours',
            onClick: () =>
              void actions.run(`Resolve ${path} (ours)`, 'resolveConflict', {
                paths: [path],
                side: 'ours',
              }),
          },
          {
            label: 'Resolve using Theirs',
            onClick: () =>
              void actions.run(`Resolve ${path} (theirs)`, 'resolveConflict', {
                paths: [path],
                side: 'theirs',
              }),
          },
        ]
      : []),
    {
      label: isDir
        ? 'Discard Folder Changes…'
        : file?.status === '?'
          ? 'Delete File…'
          : 'Discard Changes…',
      icon: <IconEraser />,
      danger: true,
      onClick: () => void discard(path),
    },
    'separator',
    { label: 'Copy Path', icon: <IconCopy />, onClick: () => void actions.copy(path, 'Path') },
  ]

  const stage = (path: string) =>
    void actions.run(`Stage ${path}`, 'stage', { paths: [path] }, { silent: true })
  const unstage = (path: string) =>
    void actions.run(`Unstage ${path}`, 'unstage', { paths: [path] }, { silent: true })
  const discardAction = (path: string, isDir: boolean, untracked: boolean): RowAction => ({
    label: isDir ? 'Discard Folder Changes…' : untracked ? 'Delete File…' : 'Discard Changes…',
    icon: <IconUndo2 className="w-3.5 h-3.5" />,
    onClick: () => void discard(path),
  })
  const stagedActions = (_: ChangedFile | undefined, path: string, isDir: boolean) => [
    discardAction(path, isDir, false),
    {
      label: isDir ? 'Unstage Folder' : 'Unstage',
      icon: <IconMinus className="w-3.5 h-3.5" />,
      primary: true,
      onClick: () => unstage(path),
    },
  ]
  const unstagedActions = (file: ChangedFile | undefined, path: string, isDir: boolean) => [
    discardAction(path, isDir, file?.status === '?'),
    {
      label: isDir ? 'Stage Folder' : 'Stage',
      icon: <IconPlus className="w-3.5 h-3.5" />,
      primary: true,
      onClick: () => stage(path),
    },
  ]

  const discard = async (path: string) => {
    const ok = await dialog.confirm(
      `Discard changes to "${path}"?`,
      'The changes are stashed away first, so Undo can restore them (not while a merge, rebase, cherry-pick or revert is in progress).',
      {
        submitLabel: 'Discard',
        danger: true,
      },
    )
    if (ok) await actions.run(`Discard ${path}`, 'discard', { paths: [path] })
  }

  if (state.error) return null
  if (!d) return <Loading />

  return (
    <div className={cls.wrap}>
      <div className={`${cls.info} flex flex-col gap-2`}>
        <div className="font-semibold flex items-center gap-2">
          <IconGitCommit className="w-4 h-4" /> Commit to{' '}
          {data.currentBranch ?? <span className="text-warning">detached HEAD</span>}
          <span className="flex-1" />
          {history.length > 0 && (
            <Dropdown
              icon={<IconHistory className="w-3.5 h-3.5" />}
              label=""
              title="Recent commit messages"
              align="right"
            >
              {(close) => (
                <div className="py-1 w-[320px] font-normal">
                  {history.map((h) => (
                    <DropdownItem
                      key={h}
                      onClick={() => {
                        close()
                        setMessage(h)
                      }}
                    >
                      <span className="truncate" title={h}>
                        {h.split('\n')[0]}
                      </span>
                    </DropdownItem>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
        </div>
        {busy && (
          <div className="text-warning text-xs">
            An operation is in progress (merge/rebase/cherry-pick/revert). Resolve conflicts, stage
            the files, then continue from the banner above.
          </div>
        )}
        <textarea
          rows={4}
          placeholder={
            amend
              ? 'Leave empty to keep the previous message'
              : 'Commit message (Ctrl+Enter to commit)'
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <MessageHints message={message} />
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="btn" disabled={!canCommit} onClick={() => void commit()}>
            {committing ? (
              <IconLoader className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <IconGitCommit className="w-3.5 h-3.5" />
            )}
            {amend ? 'Amend' : 'Commit'}
            {d.staged.length > 0 && <span className="opacity-80">({d.staged.length})</span>}
          </button>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => void setAmend(e.target.checked)}
              disabled={!data.head}
            />{' '}
            Amend last commit
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void actions.stash()}
            disabled={d.staged.length + d.unstaged.length === 0}
          >
            <IconArchive className="w-3.5 h-3.5" /> Stash…
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void actions.discardAll()}
            disabled={d.staged.length + d.unstaged.length === 0}
          >
            <IconEraser className="w-3.5 h-3.5" /> Discard All…
          </button>
        </div>
        {d.staged.length === 0 && d.unstaged.length > 0 && (
          <div className="text-fg-dim text-xs">
            Stage files before committing: hover a file and click +, press Space on it, or use
            "Stage all".
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className={cls.header}>
          <span>Staged changes</span>
          <span className="badge">{d.staged.length}</span>
          <span className="flex-1" />
          <button
            type="button"
            className="icon-btn !w-5 !h-5"
            title="Unstage all"
            disabled={d.staged.length === 0}
            onClick={() => void actions.run('Unstage all', 'unstageAll', {}, { silent: true })}
          >
            <IconMinus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-1">
          <ChangedFilesTree
            files={d.staged}
            emptyText="No staged changes"
            maxRows={treeRows}
            onOpenFile={openStaged}
            menuFor={stagedMenu}
            rowActions={stagedActions}
          />
        </div>
        <div className="section-header">
          <span>Changes</span>
          <span className="badge">{d.unstaged.length}</span>
          <span className="flex-1" />
          <button
            type="button"
            className="icon-btn !w-5 !h-5"
            title="Stage all"
            disabled={d.unstaged.length === 0}
            onClick={() => void actions.run('Stage all', 'stageAll', {}, { silent: true })}
          >
            <IconPlus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-1">
          <ChangedFilesTree
            files={d.unstaged}
            emptyText="No unstaged changes"
            maxRows={treeRows}
            onOpenFile={openUnstaged}
            menuFor={unstagedMenu}
            rowActions={unstagedActions}
          />
        </div>
      </div>
    </div>
  )
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

/** Conventional limits: subject within 50 characters (72 at most), body wrapped at 72. */
function MessageHints({ message }: { message: string }) {
  if (!message.trim()) return null
  const lines = message.split('\n')
  const subject = lines[0].length
  const longLine = lines.findIndex((l, i) => i > 0 && l.length > 72)
  return (
    <div className="flex items-center gap-3 text-xs -mt-1">
      <span
        className={subject > 72 ? 'text-danger' : subject > 50 ? 'text-warning' : 'text-fg-dim'}
        title="Keep the subject line within 50 characters (72 at most)"
      >
        Subject {subject}/50
      </span>
      {lines.length > 1 && lines[1].trim() !== '' && (
        <span className="text-warning">Add a blank line after the subject</span>
      )}
      {longLine > 0 && (
        <span className="text-warning">Line {longLine + 1} is longer than 72 characters</span>
      )}
    </div>
  )
}
