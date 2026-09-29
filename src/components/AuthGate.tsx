import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, getSession, onUnauthorized, setSession } from '@/api'
import { useToast } from './Toast'
import IconLoader from '~icons/lucide/loader-circle'
import IconKey from '~icons/lucide/key-round'

/** Parameters of a link such as `/?repo=C:\src\app#token=ABCD2345EFGH`. */
export interface LinkParams {
  /** Repository to open once the browser is paired (`?repo=`) */
  repo: string | null
  /** Single-use pairing token issued by `embegrav pair` (`#token=`) */
  token: string | null
}

const hashParams = (url: URL | Location) => new URLSearchParams(url.hash.slice(1))

export function readLinkParams(): LinkParams {
  const value = (params: URLSearchParams, key: string) => params.get(key)?.trim() || null
  return {
    repo: value(new URLSearchParams(window.location.search), 'repo'),
    token: value(hashParams(window.location), 'token'),
  }
}

/** Removes the link parameters so a reload or a copied URL does not replay them. */
function stripLinkParams(): void {
  const url = new URL(window.location.href)
  const hash = hashParams(url)
  if (!url.searchParams.has('repo') && !hash.has('token')) return
  url.searchParams.delete('repo')
  hash.delete('token')
  url.hash = hash.toString()
  window.history.replaceState(window.history.state, '', url)
}

type GateState =
  | { status: 'pairing' }
  | { status: 'ready' }
  | { status: 'unpaired'; error: string | null }

/**
 * Pairs the browser from a link's `#token=` and renders the app once it may
 * talk to the API. Any request rejected with 401 later switches to the pairing
 * screen; pairing again remounts the app so it reloads everything.
 */
export function AuthGate({ children }: { children: (link: LinkParams) => ReactNode }) {
  const toast = useToast()
  const [link, setLink] = useState(readLinkParams)
  const [state, setState] = useState<GateState>(() =>
    link.token ? { status: 'pairing' } : { status: 'ready' },
  )
  const [generation, setGeneration] = useState(0)
  const attempted = useRef<LinkParams | null>(null)

  useEffect(() => {
    stripLinkParams()
    const onHashChange = () => {
      const next = readLinkParams()
      if (!next.token) return
      attempted.current = null
      setLink((previous) => ({ ...next, repo: next.repo ?? previous.repo }))
      setState({ status: 'pairing' })
      stripLinkParams()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(
    () =>
      onUnauthorized(() =>
        setState((s) => (s.status === 'ready' ? { status: 'unpaired', error: null } : s)),
      ),
    [],
  )

  useEffect(() => {
    // Guarded by a ref rather than cancelled on cleanup: a pairing token can be
    // redeemed only once, so StrictMode's second effect run must not retry it.
    if (!link.token || attempted.current === link) return
    attempted.current = link
    const token = link.token
    void (async () => {
      // A browser that is already paired keeps its session; the unused token expires.
      if (
        getSession() &&
        (await api.checkSession().then(
          () => true,
          () => false,
        ))
      ) {
        if (attempted.current === link) setState({ status: 'ready' })
        return
      }
      if (attempted.current !== link) return
      try {
        const { session } = await api.pair(token)
        if (attempted.current !== link) return
        setSession(session)
        setState({ status: 'ready' })
      } catch (e) {
        if (attempted.current === link) {
          setState({ status: 'unpaired', error: (e as Error).message })
        }
      }
    })()
  }, [link])

  const pair = async (token: string) => {
    const { session } = await api.pair(token)
    setSession(session)
    setGeneration((g) => g + 1)
    setState({ status: 'ready' })
    toast.show('info', 'Browser paired', undefined, 3000)
  }

  if (state.status === 'pairing') {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-fg-muted">
        <IconLoader className="animate-spin" /> Pairing this browser…
      </div>
    )
  }
  if (state.status === 'unpaired') {
    return <PairingScreen initialError={state.error} onPair={pair} />
  }
  return <Fragment key={generation}>{children(link)}</Fragment>
}

function PairingScreen({
  initialError,
  onPair,
}: {
  initialError: string | null
  onPair: (token: string) => Promise<void>
}) {
  const [token, setToken] = useState('')
  const [error, setError] = useState(initialError)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim() || submitting) return
    setSubmitting(true)
    try {
      await onPair(token.trim())
    } catch (err) {
      setError((err as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <form
        className="w-full max-w-md flex flex-col gap-3"
        onSubmit={(e) => void submit(e)}
        aria-label="Pair this browser"
      >
        <h1 className="text-base font-semibold flex items-center gap-2">
          <IconKey className="w-4 h-4" /> Pair this browser
        </h1>
        <p className="text-fg-muted">
          This browser is not paired with the Embegrav server. Run{' '}
          <code className="mono">embegrav pair</code> in a terminal and open the printed link, or
          paste the pairing token here.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 mono"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Pairing token"
            aria-label="Pairing token"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="submit" className="btn" disabled={submitting || !token.trim()}>
            Pair
          </button>
        </div>
        {error && (
          <div className="text-danger" role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  )
}
