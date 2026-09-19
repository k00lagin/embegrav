import type { MouseEvent, ReactNode } from 'react'
import type { CommitStats, GitCommit, GitRef, GraphData } from '@shared/types'
import { graphWidth, type GraphRow } from '@/graph/layout'
import { formatDate, shortHash, UNCOMMITTED } from '@/lib/format'
import type { Settings } from '@/lib/settings'
import { useTheme } from '@/theme/ThemeProvider'
import { GraphCell, GraphPassThrough } from './GraphCell'
import { RefLabel, type LabelTarget } from './RefLabel'
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
  selected: string | null
  compare: string | null
  /** Change summaries keyed by commit hash (loaded lazily) */
  stats: Record<string, CommitStats>
  searchMatches: Set<string>
  currentMatch: string | null
  onSelect: (hash: string, e: MouseEvent) => void
  onContextMenu: (e: MouseEvent, row: TableRow) => void
  onRefContextMenu: (e: MouseEvent, target: LabelTarget, row: TableRow) => void
  /** Rendered in an expanded row directly below the selected commit (return null to disable) */
  renderDetails: (row: TableRow) => ReactNode
  moreAvailable: boolean
  onLoadMore: () => void
  loading: boolean
}

export function CommitTable(p: Props) {
  const gw = graphWidth(p.maxLanes)
  const refsByHash = new Map<string, GitRef[]>()
  for (const r of p.data.refs) {
    const list = refsByHash.get(r.hash)
    if (list) list.push(r)
    else refsByHash.set(r.hash, [r])
  }

  return (
    <table className="commit-table">
      <colgroup>
        <col style={{ width: gw + 8 }} />
        <col />
        <col style={{ width: 150 }} />
        <col
          style={{
            width:
              p.settings.dateFormat === 'relative'
                ? 120
                : p.settings.dateFormat === 'date'
                  ? 110
                  : 160,
          }}
        />
        <col style={{ width: 150 }} />
        <col style={{ width: 90 }} />
      </colgroup>
      <thead>
        <tr>
          <th>Graph</th>
          <th>Description</th>
          <th title="Changed files and added / removed lines (merge commits: against the first parent)">
            Diff
          </th>
          <th>Date</th>
          <th>Author</th>
          <th>Commit</th>
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
              maxLanes={p.maxLanes}
              selected={isSelected}
              compare={p.compare === hash}
              stats={p.stats[hash]}
              searchMatch={p.searchMatches.has(hash)}
              searchCurrent={p.currentMatch === hash}
              onSelect={p.onSelect}
              onContextMenu={p.onContextMenu}
              onRefContextMenu={p.onRefContextMenu}
              details={isSelected ? p.renderDetails(row) : null}
            />
          )
        })}
        {p.rows.length === 0 && !p.loading && (
          <tr>
            <td colSpan={6} className="!text-center text-fg-dim !h-16">
              No commits to display
            </td>
          </tr>
        )}
        {p.moreAvailable && (
          <tr>
            <td colSpan={6} className="!text-center !h-9">
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
  maxLanes: number
  selected: boolean
  compare: boolean
  stats?: CommitStats
  searchMatch: boolean
  searchCurrent: boolean
  onSelect: (hash: string, e: MouseEvent) => void
  onContextMenu: (e: MouseEvent, row: TableRow) => void
  onRefContextMenu: (e: MouseEvent, target: LabelTarget, row: TableRow) => void
  details: ReactNode
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

  const labels: { target: LabelTarget; current: boolean }[] = []
  if (row.kind !== 'uncommitted') {
    const sorted = [...p.refs].sort((a, b) => {
      const order = (r: GitRef) =>
        r.type === 'head' && r.name === data.currentBranch
          ? 0
          : r.type === 'head'
            ? 1
            : r.type === 'remote'
              ? 2
              : 3
      return order(a) - order(b) || a.name.localeCompare(b.name)
    })
    for (const r of sorted)
      labels.push({
        target: { kind: 'ref', ref: r },
        current: r.type === 'head' && r.name === data.currentBranch,
      })
    if (isHead && !data.currentBranch) labels.unshift({ target: { kind: 'head' }, current: true })
    if (c.stash) labels.push({ target: { kind: 'stash', stash: c.stash }, current: false })
  }

  const date = settings.dateType === 'commit' ? c.commitDate : c.date
  const authorText =
    settings.showCommitter && c.committer && c.committer !== c.author
      ? `${c.author} (committed by ${c.committer})`
      : c.author

  return (
    <>
      <tr
        id={`commit-${c.hash}`}
        className={classes.join(' ')}
        onClick={(e) => p.onSelect(c.hash, e)}
        onContextMenu={(e) => {
          e.preventDefault()
          p.onContextMenu(e, row)
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
        <td className="diff-cell">
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
        <td title={row.kind === 'uncommitted' ? '' : new Date(date * 1000).toLocaleString()}>
          {row.kind === 'uncommitted' ? '' : formatDate(date, settings.dateFormat)}
        </td>
        <td title={row.kind === 'uncommitted' ? '' : `${c.author} <${c.email}>`}>
          {row.kind === 'uncommitted' ? '' : authorText}
        </td>
        <td className="mono" title={c.hash}>
          {c.hash === UNCOMMITTED ? '' : shortHash(c.hash)}
        </td>
      </tr>
      {p.details && (
        <tr className="details-row">
          <td colSpan={6}>
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
