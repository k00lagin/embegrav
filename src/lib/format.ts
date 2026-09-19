export type DateFormat = 'relative' | 'datetime' | 'date'

const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.345, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
]

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const df = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' })

export function relativeTime(unixSeconds: number, now = Date.now()): string {
  let delta = (unixSeconds * 1000 - now) / 1000
  for (const [size, unit] of UNITS) {
    if (Math.abs(delta) < size) return rtf.format(Math.round(delta), unit)
    delta /= size
  }
  return rtf.format(Math.round(delta), 'year')
}

export function formatDate(unixSeconds: number, format: DateFormat): string {
  const d = new Date(unixSeconds * 1000)
  if (format === 'relative') return relativeTime(unixSeconds)
  if (format === 'date') return df.format(d)
  return dtf.format(d)
}

export function formatFullDate(unixSeconds: number): string {
  return `${full.format(new Date(unixSeconds * 1000))} (${relativeTime(unixSeconds)})`
}

export function shortHash(hash: string, length = 8): string {
  return hash.slice(0, length)
}

export const UNCOMMITTED = 'UNCOMMITTED'

export function isUncommitted(hash: string | null | undefined): boolean {
  return hash === UNCOMMITTED
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}
