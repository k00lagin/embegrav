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

/** Rank repositories with a visit score and keep the original order of the rest. */
export function groupByFrecency<T extends { path: string }>(repos: T[], now = Date.now()) {
  const visits = loadLocal<Visits>(KEY, {}, isVisits)
  const ranked: { repo: T; score: number }[] = []
  const others: T[] = []
  for (const repo of repos) {
    const visit = visits[repo.path]
    if (visit && visit.score > 0) ranked.push({ repo, score: decayed(visit, now) })
    else others.push(repo)
  }
  ranked.sort((a, b) => b.score - a.score)
  return { recent: ranked.map(({ repo }) => repo), others }
}
