import {
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { CommitStats, GitCommit, GitRef, GraphData } from '@shared/types'
import { graphWidth, type GraphRow } from '@/graph/layout'
import {
  COLUMNS,
  columnWidth,
  MIN_COLUMN_WIDTH,
  type ColumnId,
  type ColumnLayout,
} from '@/lib/columns'
import { formatDate, shortHash, UNCOMMITTED } from '@/lib/format'
import type { Settings } from '@/lib/settings'
import type { DropTarget } from '@/hooks/useRepoActions'
import { useTheme } from '@/theme/ThemeProvider'
import { GraphCell, GraphPassThrough } from './GraphCell'
import { BRANCH_DRAG_TYPE, RefLabel, type LabelTarget } from './RefLabel'
import IconLoader from '~icons/lucide/loader-circle'

export interface TableRow {
  commit: GitCommit
  graph: GraphRow
  kind: 'commit' | 'uncommitted' | 'stash'
}

interface Props {
  rows: TableRow[]
  maxLanes: number
  data: GraphData
  settings: Settings
  columns: ColumnLayout
  onColumnsChange: (next: ColumnLayout) => void
  onHeaderContextMenu: (e: MouseEvent) => void
  selected: string | null
  compare: string | null
  /** Row with the keyboard cursor */
  focused: string | null
  /** Change summaries keyed by commit hash (loaded lazily) */
  stats: Record<string, CommitStats>
  searchMatches: Set<string>
  currentMatch: string | null
  onSelect: (hash: string, e: MouseEvent) => void
  onRowKeyDown: (e: KeyboardEvent, hash: string) => void
  onContextMenu: (e: MouseEvent, row: TableRow) => void
  onRefContextMenu: (e: MouseEvent, target: LabelTarget, row: TableRow) => void
  onBranchDrop: (source: string, target: DropTarget, e: DragEvent) => void
  /** Rendered in an expanded row directly below the selected commit (return null to disable) */
  renderDetails: (row: TableRow) => ReactNode
  moreAvailable: boolean
  onLoadMore: () => void
  loading: boolean
}

const COLUMN_HEADERS: Record<ColumnId, { title?: string }> = {
  diff: {
    title: 'Changed files and added / removed lines (merge commits: against the first parent)',
  },
  date: {},
  author: {},
  hash: {},
}

export function CommitTable(p: Props) {
  const gw = graphWidth(p.maxLanes)
  const refsByHash = new Map<string, GitRef[]>()
  for (const r of p.data.refs) {
    const list = refsByHash.get(r.hash)
    if (list) list.push(r)
    else refsByHash.set(r.hash, [r])
  }
  const visible = COLUMNS.filter((c) => !p.columns.hidden.includes(c.id))
  const colSpan = 2 + visible.length
  const width = (id: ColumnId) => columnWidth(p.columns, id, p.settings.dateFormat)
  const [dropHash, setDropHash] = useState<string | null>(null)

  const startResize = (e: MouseEvent, id: ColumnId) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = width(id)
    let latest = p.columns
    const onMove = (ev: globalThis.MouseEvent) => {
      latest = {
        ...latest,
        widths: {
          ...latest.widths,
          [id]: Math.round(Math.max(MIN_COLUMN_WIDTH, startW + ev.clientX - startX)),
        },
      }
      p.onColumnsChange(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const resetWidth = (id: ColumnId) => {
    const widths = { ...p.columns.widths }
    delete widths[id]
    p.onColumnsChange({ ...p.columns, widths })
  }

  return (
    <table className="commit-table" onDragEnd={() => setDropHash(null)}>
      <colgroup>
        <col style={{ width: gw + 8 }} />
        <col />
        {visible.map((c) => (
          <col key={c.id} style={{ width: width(c.id) }} />
        ))}
      </colgroup>
      <thead onContextMenu={p.onHeaderContextMenu}>
        <tr>
          <th>Graph</th>
          <th title="Right-click a column header to show or hide columns">Description</th>
          {visible.map((c) => (
            <th key={c.id} title={COLUMN_HEADERS[c.id].title} className="relative">
              {c.label}
              <span
                className="col-resizer"
                title="Drag to resize, double-click to reset"
                onMouseDown={(e) => startResize(e, c.id)}
                onDoubleClick={() => resetWidth(c.id)}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {p.rows.map((row) => {
          const hash = row.commit.hash
          const isSelected = p.selected === hash
          return (
            <RowGroup
              key={hash}
              row={row}
              refs={refsByHash.get(hash) ?? []}
              data={p.data}
              settings={p.settings}
              columns={visible.map((c) => c.id)}
              colSpan={colSpan}
              maxLanes={p.maxLanes}
              selected={isSelected}
              compare={p.compare === hash}
              focused={p.focused === hash}
              dropTarget={dropHash === hash}
              stats={p.stats[hash]}
              searchMatch={p.searchMatches.has(hash)}
              searchCurrent={p.currentMatch === hash}
              onSelect={p.onSelect}
              onKeyDown={p.onRowKeyDown}
              onContextMenu={p.onContextMenu}
              onRefContextMenu={p.onRefContextMenu}
              onDropHover={setDropHash}
              onBranchDrop={(source, target, e) => {
                setDropHash(null)
                p.onBranchDrop(source, target, e)
              }}
              details={isSelected ? p.renderDetails(row) : null}
            />
          )
        })}
        {p.rows.length === 0 && !p.loading && (
          <tr>
            <td colSpan={colSpan} className="!text-center text-fg-dim !h-16">
              No commits to display
            </td>
          </tr>
        )}
        {p.moreAvailable && (
          <tr>
            <td colSpan={colSpan} className="!text-center !h-9">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={p.onLoadMore}
                disabled={p.loading}
              >
                {p.loading && <IconLoader className="w-3.5 h-3.5 animate-spin" />} Load More Commits
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

interface RowProps {
  row: TableRow
  refs: GitRef[]
  data: GraphData
  settings: Settings
  columns: ColumnId[]
  colSpan: number
  maxLanes: number
  selected: boolean
  compare: boolean
  focused: boolean
  dropTarget: boolean
  stats?: CommitStats
  searchMatch: boolean
  searchCurrent: boolean
  onSelect: (hash: string, e: MouseEvent) => void
  onKeyDown: (e: KeyboardEvent, hash: string) => void
  onContextMenu: (e: MouseEvent, row: TableRow) => void
  onRefContextMenu: (e: MouseEvent, target: LabelTarget, row: TableRow) => void
  onDropHover: (hash: string | null) => void
  onBranchDrop: (source: string, target: DropTarget, e: DragEvent) => void
  details: ReactNode
}

/**
 * Labels for the refs on one commit, current branch first. A local branch and
 * the remote-tracking branch it matches share one label when they point here.
 */
function refLabels(refs: GitRef[], currentBranch: string | null) {
  const remotes = refs.filter((r) => r.type === 'remote')
  const absorbed = new Set<GitRef>()
  const labels: { target: LabelTarget; current: boolean }[] = []
  const order = (r: GitRef) =>
    r.type === 'head' && r.name === currentBranch
      ? 0
      : r.type === 'head'
        ? 1
        : r.type === 'remote'
          ? 2
          : 3
  const sorted = [...refs].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
  for (const r of sorted) {
    if (r.type !== 'head') continue
    const synced = remotes.find(
      (x) =>
        !absorbed.has(x) &&
        (r.upstream ? x.name === r.upstream : !!x.remote && x.name === `${x.remote}/${r.name}`),
    )
    if (synced) absorbed.add(synced)
    labels.push({ target: { kind: 'ref', ref: r, synced }, current: r.name === currentBranch })
  }
  for (const r of sorted)
    if (r.type !== 'head' && !absorbed.has(r))
      labels.push({ target: { kind: 'ref', ref: r }, current: false })
  return labels
}

function RowGroup(p: RowProps) {
  const { row, data, settings } = p
  const c = row.commit
  const { graphColors } = useTheme()
  const color = graphColors[row.graph.color]
  const isHead = c.hash === data.head
  const classes = ['commit-row']
  if (p.selected) classes.push('selected')
  if (p.compare) classes.push('compare')
  if (p.searchCurrent) classes.push('search-current')
  else if (p.searchMatch) classes.push('search-match')
  if (isHead) classes.push('head')
  if (p.dropTarget) classes.push('drop-target')

  const labels: { target: LabelTarget; current: boolean }[] = []
  if (row.kind !== 'uncommitted') {
    labels.push(...refLabels(p.refs, data.currentBranch))
    if (isHead && !data.currentBranch) labels.unshift({ target: { kind: 'head' }, current: true })
    if (c.stash) labels.push({ target: { kind: 'stash', stash: c.stash }, current: false })
  }

  const date = settings.dateType === 'commit' ? c.commitDate : c.date
  const authorText =
    settings.showCommitter && c.committer && c.committer !== c.author
      ? `${c.author} (committed by ${c.committer})`
      : c.author
  const acceptsDrop = (e: DragEvent) =>
    row.kind === 'commit' && e.dataTransfer.types.includes(BRANCH_DRAG_TYPE)

  const cells: Record<ColumnId, ReactNode> = {
    diff: (
      <td key="diff" className="diff-cell">
        {p.stats && (
          <span
            className="inline-flex items-center gap-1.5 text-xs"
            title={`${p.stats.files} changed file${p.stats.files === 1 ? '' : 's'}, +${p.stats.additions} −${p.stats.deletions} lines`}
          >
            <span className="badge">{p.stats.files}</span>
            <span className="text-success">+{p.stats.additions}</span>
            <span className="text-danger">−{p.stats.deletions}</span>
          </span>
        )}
      </td>
    ),
    date: (
      <td
        key="date"
        title={row.kind === 'uncommitted' ? '' : new Date(date * 1000).toLocaleString()}
      >
        {row.kind === 'uncommitted' ? '' : formatDate(date, settings.dateFormat)}
      </td>
    ),
    author: (
      <td key="author" title={row.kind === 'uncommitted' ? '' : `${c.author} <${c.email}>`}>
        {row.kind === 'uncommitted' ? '' : authorText}
      </td>
    ),
    hash: (
      <td key="hash" className="mono" title={c.hash}>
        {c.hash === UNCOMMITTED ? '' : shortHash(c.hash)}
      </td>
    ),
  }

  return (
    <>
      <tr
        id={`commit-${c.hash}`}
        className={classes.join(' ')}
        tabIndex={p.focused ? 0 : -1}
        aria-selected={p.selected}
        onClick={(e) => p.onSelect(c.hash, e)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget) p.onKeyDown(e, c.hash)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          p.onContextMenu(e, row)
        }}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!p.dropTarget) p.onDropHover(c.hash)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onDropHover(null)
        }}
        onDrop={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          const source = e.dataTransfer.getData(BRANCH_DRAG_TYPE)
          const label = (e.target as HTMLElement).closest<HTMLElement>('[data-branch]')
          if (source) p.onBranchDrop(source, { hash: c.hash, branch: label?.dataset.branch }, e)
        }}
      >
        <td className="graph-cell">
          <GraphCell row={row.graph} maxLanes={p.maxLanes} kind={row.kind} isHead={isHead} />
        </td>
        <td className="description" title={c.subject}>
          {labels.map((l, i) => (
            <RefLabel
              key={i}
              target={l.target}
              color={color}
              current={l.current}
              onContextMenu={(e, t) => p.onRefContextMenu(e, t, row)}
              onClick={(e, t) => p.onRefContextMenu(e, t, row)}
            />
          ))}
          {row.kind === 'uncommitted' ? <span className="italic">{c.subject}</span> : c.subject}
        </td>
        {p.columns.map((id) => cells[id])}
      </tr>
      {p.details && (
        <tr className="details-row">
          <td colSpan={p.colSpan}>
            <div className="relative">
              <GraphPassThrough active={row.graph.active} maxLanes={p.maxLanes} />
              <div style={{ marginLeft: graphWidth(p.maxLanes) + 8 }}>{p.details}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
