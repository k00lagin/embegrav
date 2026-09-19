/**
 * Commit graph lane layout.
 *
 * Commits are processed top-down (newest first, as returned by `git log`).
 * Each lane tracks the commit hash it expects to reach next. When a commit is
 * found in one or more lanes, those lines end on its node; the commit's
 * parents then continue (or start) lines below the node.
 *
 * The output describes, for every row, which segments to draw *inside that
 * row only*, so each row can render its own small SVG. This keeps the graph
 * correct even when a details panel is expanded between rows.
 */

export const LANE_WIDTH = 16
export const ROW_HEIGHT = 24
export const GRAPH_PADDING_LEFT = 6

/**
 * Number of distinct lane colours. The actual colours come from the active
 * VS Code theme (see `graphColorsFor()` in src/theme/vscode.ts); the layout
 * only assigns colour indexes.
 */
export const GRAPH_COLOR_COUNT = 12

export interface GraphCommitInput {
  hash: string
  parents: string[]
}

export type SegmentPart = 'top' | 'bottom' | 'through'

export interface GraphSegment {
  /** Lane at the start of the segment */
  from: number
  /** Lane at the end of the segment */
  to: number
  part: SegmentPart
  color: number
}

export interface ActiveLane {
  lane: number
  color: number
}

export interface GraphRow {
  lane: number
  color: number
  segments: GraphSegment[]
  /** Lanes still active below this row (used to draw pass-through lines in expanded rows) */
  active: ActiveLane[]
  /** Number of lanes this row touches */
  width: number
}

export interface GraphLayout {
  rows: GraphRow[]
  maxLanes: number
}

interface Lane {
  hash: string
  color: number
}

export function layoutGraph(commits: GraphCommitInput[]): GraphLayout {
  const lanes: (Lane | null)[] = []
  let nextColor = 0
  const rows: GraphRow[] = []
  let maxLanes = 1

  const firstFree = (): number => {
    const idx = lanes.indexOf(null)
    if (idx >= 0) return idx
    lanes.push(null)
    return lanes.length - 1
  }
  const newColor = () => nextColor++ % GRAPH_COLOR_COUNT

  for (const commit of commits) {
    const segments: GraphSegment[] = []
    const incoming: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i]?.hash === commit.hash) incoming.push(i)
    }

    let lane: number
    let color: number
    if (incoming.length > 0) {
      lane = incoming[0]
      color = lanes[lane]!.color
    } else {
      lane = firstFree()
      color = newColor()
    }

    // Lines passing through this row untouched.
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i]
      if (l && !incoming.includes(i))
        segments.push({ from: i, to: i, part: 'through', color: l.color })
    }
    // Lines ending on this node.
    for (const i of incoming) {
      segments.push({ from: i, to: lane, part: 'top', color: lanes[i]!.color })
      lanes[i] = null
    }

    // Lines leaving this node towards its parents.
    commit.parents.forEach((parent, pi) => {
      const existing = lanes.findIndex((l) => l?.hash === parent)
      if (existing >= 0) {
        segments.push({ from: lane, to: existing, part: 'bottom', color: lanes[existing]!.color })
        return
      }
      if (pi === 0) {
        lanes[lane] = { hash: parent, color }
        segments.push({ from: lane, to: lane, part: 'bottom', color })
      } else {
        const target = firstFree()
        const c = newColor()
        lanes[target] = { hash: parent, color: c }
        segments.push({ from: lane, to: target, part: 'bottom', color: c })
      }
    })

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    let width = lane + 1
    for (const s of segments) width = Math.max(width, s.from + 1, s.to + 1)
    maxLanes = Math.max(maxLanes, width)

    rows.push({
      lane,
      color,
      segments,
      active: lanes.flatMap((l, i) => (l ? [{ lane: i, color: l.color }] : [])),
      width,
    })
  }

  return { rows, maxLanes }
}

export function laneX(lane: number): number {
  return GRAPH_PADDING_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2
}

export function graphWidth(maxLanes: number): number {
  return GRAPH_PADDING_LEFT * 2 + maxLanes * LANE_WIDTH
}
