import { loadLocal, saveLocal } from './settings'

/**
 * Frecency: every visit adds 1 to a score that halves every HALF_LIFE, so
 * repositories opened often and recently rise to the top while old habits fade.
 */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000
const KEY = 'repoVisits'

type Visits = Record<string, { score: number; time: number }>

const isVisits = (value: unknown): value is Visits =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (v) =>
      !!v &&
      typeof v === 'object' &&
      typeof (v as Record<string, unknown>).score === 'number' &&
      typeof (v as Record<string, unknown>).time === 'number',
  )

const decayed = (visit: Visits[string] | undefined, now: number) =>
  visit ? visit.score * 2 ** (-(now - visit.time) / HALF_LIFE_MS) : 0

export function recordRepoVisit(path: string, now = Date.now()): void {
  const visits = loadLocal<Visits>(KEY, {}, isVisits)
  visits[path] = { score: decayed(visits[path], now) + 1, time: now }
  saveLocal(KEY, visits)
}

/** Most frecent first; repositories with equal scores (such as never opened) keep their order. */
export function sortByFrecency<T extends { path: string }>(repos: T[], now = Date.now()): T[] {
  const visits = loadLocal<Visits>(KEY, {}, isVisits)
  const rank = new Map(repos.map((r) => [r.path, decayed(visits[r.path], now)]))
  return repos.toSorted((a, b) => rank.get(b.path)! - rank.get(a.path)!)
}
