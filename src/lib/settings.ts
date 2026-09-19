import { useCallback, useState } from 'react'
import type { CommitOrder } from '@shared/types'
import type { DateFormat } from './format'

export interface Settings {
  maxCommits: number
  showRemoteBranches: boolean
  showStashes: boolean
  showTags: boolean
  showUncommitted: boolean
  order: CommitOrder
  dateFormat: DateFormat
  dateType: 'author' | 'commit'
  fetchAndPrune: boolean
  diffStyle: 'unified' | 'split'
  /** unified = details expand inline below the commit; split = details in a side panel */
  commitView: 'unified' | 'split'
  autoRefresh: boolean
  showCommitter: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  maxCommits: 300,
  showRemoteBranches: true,
  showStashes: true,
  showTags: true,
  showUncommitted: true,
  order: 'date',
  dateFormat: 'datetime',
  dateType: 'author',
  fetchAndPrune: true,
  diffStyle: 'unified',
  commitView: 'unified',
  autoRefresh: true,
  showCommitter: false,
}

const KEY = 'repotree.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_SETTINGS
    const stored = value as Record<string, unknown>
    const settings = { ...DEFAULT_SETTINGS }
    for (const key of [
      'showRemoteBranches',
      'showStashes',
      'showTags',
      'showUncommitted',
      'fetchAndPrune',
      'autoRefresh',
      'showCommitter',
    ] as const) {
      if (typeof stored[key] === 'boolean') settings[key] = stored[key]
    }
    if (
      typeof stored.maxCommits === 'number' &&
      Number.isInteger(stored.maxCommits) &&
      stored.maxCommits >= 1 &&
      stored.maxCommits <= 50_000
    ) {
      settings.maxCommits = stored.maxCommits
    }
    settings.order = choice(stored.order, ['date', 'author-date', 'topo'], settings.order)
    settings.dateFormat = choice(
      stored.dateFormat,
      ['relative', 'datetime', 'date'],
      settings.dateFormat,
    )
    settings.dateType = choice(stored.dateType, ['author', 'commit'], settings.dateType)
    settings.diffStyle = choice(stored.diffStyle, ['unified', 'split'], settings.diffStyle)
    settings.commitView = choice(stored.commitView, ['unified', 'split'], settings.commitView)
    return settings
  } catch {
    return DEFAULT_SETTINGS
  }
}

function choice<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((option) => option === value) ?? fallback
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(load)
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])
  return [settings, update]
}

/** Per-repository UI state that should survive reloads (selected branches, last repo). */
export function loadLocal<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(`repotree.${key}`)
    const value: unknown = raw ? JSON.parse(raw) : undefined
    return isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`repotree.${key}`, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
