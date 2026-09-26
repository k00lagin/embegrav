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

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const df = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: '2-digit' })
const full = new Intl.DateTimeFormat('en', {
  dateStyle: 'full',
  timeStyle: 'long',
  hourCycle: 'h23',
})

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

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}
