import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RepoInfo } from '@shared/types'
import { api } from '@/api'
import { loadLocal, saveLocal } from '@/lib/settings'
import IconImage from '~icons/lucide/image'

export type RepoIconChoice =
  | { kind: 'project'; file: string }
  | { kind: 'upload'; file: string; src: string }

function storageKey(path: string): string {
  const key = /^(?:[a-z]:[\\/]|\\\\)/i.test(path) ? path.replaceAll('\\', '/').toLowerCase() : path
  return `repoIcon:${key}`
}

function isIconChoice(value: unknown): value is RepoIconChoice {
  if (!value || typeof value !== 'object' || !('file' in value) || typeof value.file !== 'string')
    return false
  if (!('kind' in value)) return false
  return (
    value.kind === 'project' ||
    (value.kind === 'upload' &&
      'src' in value &&
      typeof value.src === 'string' &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.src))
  )
}

const RepoIconContext = createContext<{
  choices: ReadonlyMap<string, RepoIconChoice | null>
  setChoice: (path: string, choice: RepoIconChoice | null) => void
} | null>(null)

export function RepoIconProvider({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState(() => new Map<string, RepoIconChoice | null>())
  const setChoice = (path: string, choice: RepoIconChoice | null) => {
    const key = storageKey(path)
    saveLocal(key, choice)
    setChoices((prev) => new Map(prev).set(key, choice))
  }
  return (
    <RepoIconContext.Provider value={{ choices, setChoice }}>{children}</RepoIconContext.Provider>
  )
}

export function useRepoIconChoice(path: string) {
  const context = useContext(RepoIconContext)
  const key = storageKey(path)
  const saved = useMemo(() => loadLocal(key, null, isIconChoice), [key])
  const updated = context?.choices.get(key)
  const choice = updated === undefined ? saved : updated
  return { choice, setChoice: context?.setChoice }
}

const colors = ['#B65B43', '#986C15', '#66813D', '#337D73', '#487BB4', '#6658B7', '#A05282']

function monogram(name: string): string {
  const [first, second] = name.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
  if (!first) return 'PR'
  const [initial, ...rest] = first
  const next = second
    ? [...second][0]
    : rest.find(
        (letter, i) =>
          /\p{Nd}/u.test(letter) ||
          (/\p{Ll}/u.test(i ? rest[i - 1] : initial) && /\p{Lu}/u.test(letter)),
      )
  return `${initial}${next ?? ''}`.toUpperCase()
}

function repositoryColor(name: string): string {
  let hash = 2166136261
  for (const byte of new TextEncoder().encode(name)) hash = Math.imul(hash ^ byte, 16777619)
  return colors[(hash >>> 0) % colors.length]
}

export async function decodeIcon(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

async function loadRepoIcon(path: string, file: string | undefined, signal: AbortSignal) {
  if (file) {
    const custom = await api.repoIcon(path, file, undefined, signal).catch(() => null)
    if (
      custom?.icon &&
      (await decodeIcon(custom.icon.src).then(
        () => true,
        () => false,
      ))
    ) {
      return custom.icon.src
    }
  }
  const skip: string[] = file ? [file] : []
  while (!signal.aborted && skip.length < 48) {
    const { icon } = await api.repoIcon(path, undefined, skip, signal)
    if (!icon) return null
    if (
      await decodeIcon(icon.src).then(
        () => true,
        () => false,
      )
    )
      return icon.src
    if (skip.includes(icon.file)) return null
    skip.push(icon.file)
  }
  return null
}

type LoadIcon = (signal: AbortSignal) => Promise<string | null>

function IconBadge({
  load,
  src,
  eager = false,
  fallback,
}: {
  load?: LoadIcon
  src?: string
  eager?: boolean
  fallback: ReactNode
}) {
  const badge = useRef<HTMLSpanElement>(null)
  const [loaded, setLoaded] = useState<{ load: LoadIcon; src: string } | null>(null)
  const image = src ?? (loaded?.load === load ? loaded?.src : undefined)

  useEffect(() => {
    if (!load || !badge.current) return
    const request = new AbortController()
    const start = () => {
      if (request.signal.aborted) return
      void load(request.signal).then(
        (resolvedSrc) => {
          if (!request.signal.aborted) setLoaded(resolvedSrc ? { load, src: resolvedSrc } : null)
        },
        () => {},
      )
    }
    let observer: IntersectionObserver | undefined
    if (!eager && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer?.disconnect()
        start()
      })
      observer.observe(badge.current)
    } else start()
    return () => {
      observer?.disconnect()
      request.abort()
    }
  }, [load, eager])

  return (
    <span
      ref={badge}
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center"
    >
      {image ? (
        <img
          src={image}
          alt=""
          draggable={false}
          className="size-full object-contain rounded-sm"
          onError={() => setLoaded(null)}
        />
      ) : (
        fallback
      )}
    </span>
  )
}

export function RepoIcon({ repo, eager = false }: { repo: RepoInfo; eager?: boolean }) {
  const { path, name } = repo
  const { choice } = useRepoIconChoice(path)
  const file = choice?.kind === 'project' ? choice.file : undefined
  const upload = choice?.kind === 'upload' ? choice.src : undefined
  const load = useCallback((signal: AbortSignal) => loadRepoIcon(path, file, signal), [path, file])
  return (
    <IconBadge
      load={upload ? undefined : load}
      src={upload}
      eager={eager}
      fallback={
        <span
          className="size-full grid place-items-center rounded-sm text-[10px] font-bold text-white leading-none before:content-[attr(data-monogram)]"
          data-monogram={monogram(name)}
          style={{ backgroundColor: repositoryColor(name) }}
        />
      }
    />
  )
}

export function RepoIconFilePreview({ repoPath, file }: { repoPath: string; file: string }) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const { icon } = await api.repoIcon(repoPath, file, undefined, signal)
      return icon?.src ?? null
    },
    [repoPath, file],
  )
  return <IconBadge load={load} fallback={<IconImage className="w-4 h-4 text-fg-muted" />} />
}
