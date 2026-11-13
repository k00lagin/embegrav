// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { recordRepoVisit, sortByFrecency } from '@/lib/frecency'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000
const repos = [{ path: 'A' }, { path: 'B' }, { path: 'C' }]
const order = () => sortByFrecency(repos, NOW).map((r) => r.path)

beforeEach(() => localStorage.clear())

it('keeps the given order for repositories never opened', () => {
  recordRepoVisit('C', NOW)
  expect(order()).toEqual(['C', 'A', 'B'])
})

it('ranks frequent recent use above a single recent visit', () => {
  for (const t of [3, 2, 1]) recordRepoVisit('A', NOW - t * DAY)
  recordRepoVisit('B', NOW)
  expect(order()).toEqual(['A', 'B', 'C'])
})

it('lets frequent use from long ago fade below a recent visit', () => {
  for (let i = 0; i < 5; i++) recordRepoVisit('A', NOW - 40 * DAY + i)
  recordRepoVisit('B', NOW - DAY)
  expect(order()).toEqual(['B', 'A', 'C'])
})

it('ignores malformed stored visits', () => {
  localStorage.setItem('embegrav.repoVisits', JSON.stringify({ B: { score: 'x' } }))
  expect(order()).toEqual(['A', 'B', 'C'])
  recordRepoVisit('B', NOW)
  expect(order()).toEqual(['B', 'A', 'C'])
})
