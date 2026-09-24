import { useCallback, useState } from 'react'
import type { DateFormat } from './format'
import { loadLocal, saveLocal } from './settings'

/** Optional commit table columns (Graph and Description are always shown). */
export type ColumnId = 'diff' | 'date' | 'author' | 'hash'

export const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'diff', label: 'Diff' },
  { id: 'date', label: 'Date' },
  { id: 'author', label: 'Author' },
  { id: 'hash', label: 'Commit' },
]

export const MIN_COLUMN_WIDTH = 40

export interface ColumnLayout {
  hidden: ColumnId[]
  /** User-chosen widths; missing entries use the default */
  widths: Partial<Record<ColumnId, number>>
}

const DEFAULT_LAYOUT: ColumnLayout = { hidden: [], widths: {} }

export function defaultColumnWidth(id: ColumnId, dateFormat: DateFormat): number {
  if (id === 'date') return dateFormat === 'relative' ? 120 : dateFormat === 'date' ? 110 : 160
  if (id === 'hash') return 90
  return 150
}

export function columnWidth(layout: ColumnLayout, id: ColumnId, dateFormat: DateFormat): number {
  return layout.widths[id] ?? defaultColumnWidth(id, dateFormat)
}

const isColumn = (value: unknown): value is ColumnId => COLUMNS.some((c) => c.id === value)

function isLayout(value: unknown): value is ColumnLayout {
  if (!value || typeof value !== 'object') return false
  const { hidden, widths } = value as Record<string, unknown>
  return (
    Array.isArray(hidden) &&
    hidden.every(isColumn) &&
    !!widths &&
    typeof widths === 'object' &&
    Object.entries(widths).every(
      ([key, w]) =>
        isColumn(key) && typeof w === 'number' && Number.isFinite(w) && w >= MIN_COLUMN_WIDTH,
    )
  )
}

/** Visible columns and widths of the commit table, persisted in localStorage. */
export function useColumnLayout(): [ColumnLayout, (next: ColumnLayout) => void] {
  const [layout, setLayout] = useState(() => loadLocal('columns', DEFAULT_LAYOUT, isLayout))
  const update = useCallback((next: ColumnLayout) => {
    setLayout(next)
    saveLocal('columns', next)
  }, [])
  return [layout, update]
}
