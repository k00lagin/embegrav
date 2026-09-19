import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CommitStats, GraphData, GraphRequest } from '@shared/types'
import { api } from '@/api'
import { UNCOMMITTED } from '@/lib/format'

/** A refresh belongs to a repository visit, even after its action finishes elsewhere. */
export function useRepoGraph(request: GraphRequest | null) {
  const repo = request?.repo ?? null
  const session = useMemo(() => ({ repo }), [repo])
  const active = useRef<{ session: typeof session | null; sequence: number }>({
    session: null,
    sequence: 0,
  })
  const latestLoad = useRef<() => Promise<void>>(async () => {})
  const [state, setState] = useState<{
    session: typeof session
    data: GraphData | null
    error: string | null
    loading: boolean
    version: number
  } | null>(null)
  const statsCache = useRef<Record<string, CommitStats>>({})
  const [statsState, setStats] = useState<{
    session: typeof session
    values: Record<string, CommitStats>
  } | null>(null)

  useLayoutEffect(() => {
    const visit = active.current
    visit.session = session
    statsCache.current = {}
    return () => {
      visit.session = null
      visit.sequence++
    }
  }, [session])

  const load = useCallback(async () => {
    if (!request || active.current.session !== session) return
    const sequence = ++active.current.sequence
    setState((previous) => ({
      session,
      data: previous?.session === session ? previous.data : null,
      error: null,
      loading: true,
      version: previous?.version ?? 0,
    }))
    try {
      const data = await api.graph(request)
      if (active.current.session !== session || sequence !== active.current.sequence) return
      setState((previous) => ({
        session,
        data,
        error: null,
        loading: false,
        version: (previous?.version ?? 0) + 1,
      }))
    } catch (error) {
      if (active.current.session !== session || sequence !== active.current.sequence) return
      setState((previous) => ({
        session,
        data: previous?.session === session ? previous.data : null,
        error: (error as Error).message,
        loading: false,
        version: previous?.version ?? 0,
      }))
    }
  }, [request, session])

  useLayoutEffect(() => {
    latestLoad.current = load
  }, [load])
  const refresh = useCallback(() => {
    if (active.current.session === session) void latestLoad.current()
  }, [session])
  useEffect(() => {
    const visit = active.current
    // oxlint-disable-next-line react/set-state-in-effect -- loading state tracks this server request
    void load()
    return () => {
      visit.sequence++
    }
  }, [load])

  const data = state?.session === session ? state.data : null
  useEffect(() => {
    if (!repo || !data) return
    const missing = data.commits
      .map((commit) => commit.hash)
      .filter((hash) => !(hash in statsCache.current))
    if (data.uncommitted.length > 0) missing.push(UNCOMMITTED)
    if (missing.length === 0) return
    let cancelled = false
    void api
      .stats(repo, missing)
      .then((result) => {
        if (cancelled || active.current.session !== session) return
        statsCache.current = { ...statsCache.current, ...result.stats }
        setStats({ session, values: statsCache.current })
      })
      .catch(() => {
        /* Optional summaries can be retried on the next graph refresh. */
      })
    return () => {
      cancelled = true
    }
  }, [repo, data, session])

  return {
    data,
    error: state?.session === session ? state.error : null,
    loading: state?.session === session ? state.loading : repo !== null,
    version: state?.session === session ? state.version : 0,
    stats: statsState?.session === session ? statsState.values : {},
    refresh,
  }
}
