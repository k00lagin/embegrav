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
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
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
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`repotree.${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
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
