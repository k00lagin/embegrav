import { memo } from 'react'
import { graphWidth, laneX, ROW_HEIGHT, type ActiveLane, type GraphRow } from '@/graph/layout'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  row: GraphRow
  maxLanes: number
  kind: 'commit' | 'uncommitted' | 'stash'
  isHead?: boolean
}

function segmentPath(x1: number, x2: number, part: 'top' | 'bottom' | 'through'): string {
  const h = ROW_HEIGHT
  const mid = h / 2
  if (part === 'through') return `M${x1} 0 L${x1} ${h}`
  if (part === 'top') {
    if (x1 === x2) return `M${x1} 0 L${x1} ${mid}`
    return `M${x1} 0 C${x1} ${mid * 0.9} ${x2} ${mid * 0.1} ${x2} ${mid}`
  }
  if (x1 === x2) return `M${x1} ${mid} L${x1} ${h}`
  return `M${x1} ${mid} C${x1} ${mid + mid * 0.9} ${x2} ${mid + mid * 0.1} ${x2} ${h}`
}

export const GraphCell = memo(function GraphCell({ row, maxLanes, kind, isHead }: Props) {
  const { graphColors } = useTheme()
  const width = graphWidth(maxLanes)
  const cx = laneX(row.lane)
  const cy = ROW_HEIGHT / 2
  const color = graphColors[row.color]
  return (
    <svg width={width} height={ROW_HEIGHT} className="block" aria-hidden="true">
      {row.segments.map((s, i) => (
        <path
          key={i}
          d={segmentPath(laneX(s.from), laneX(s.to), s.part)}
          stroke={graphColors[s.color]}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {kind === 'uncommitted' ? (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="var(--vscode-editor-background)"
          stroke={color}
          strokeWidth={2}
        />
      ) : kind === 'stash' ? (
        <rect
          x={cx - 4}
          y={cy - 4}
          width={8}
          height={8}
          rx={1.5}
          fill={color}
          stroke="var(--vscode-editor-background)"
          strokeWidth={1}
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={isHead ? 5 : 4}
          fill={color}
          stroke={isHead ? 'var(--vscode-foreground)' : 'none'}
          strokeWidth={isHead ? 1.5 : 0}
        />
      )}
    </svg>
  )
})

/** Vertical pass-through lines for an expanded (details) row. */
export function GraphPassThrough({ active, maxLanes }: { active: ActiveLane[]; maxLanes: number }) {
  const { graphColors } = useTheme()
  const width = graphWidth(maxLanes)
  return (
    <svg
      width={width}
      height="100%"
      className="absolute inset-y-0 left-0"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {active.map((a) => (
        <line
          key={a.lane}
          x1={laneX(a.lane)}
          x2={laneX(a.lane)}
          y1={0}
          y2="100%"
          stroke={graphColors[a.color]}
          strokeWidth={2}
        />
      ))}
    </svg>
  )
}
