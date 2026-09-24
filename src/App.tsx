import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react'
import type { GitCommit, GraphRequest, RepoInfo } from '@shared/types'
import { api, subscribeRepoEvents } from './api'
import { layoutGraph } from './graph/layout'
import { UNCOMMITTED, pluralize, shortHash } from './lib/format'
import { loadLocal, saveLocal, useSettings } from './lib/settings'
import { COLUMNS, useColumnLayout } from './lib/columns'
import { parentPath } from './lib/paths'
import { useRepoActions } from './hooks/useRepoActions'
import { useRepoGraph } from './hooks/useRepoGraph'
import { CommitDetails, type DetailsMode } from './components/CommitDetails'
import { CommitTable, type TableRow } from './components/CommitTable'
import { ContextMenu, type ContextMenuState, type MenuEntry } from './components/ContextMenu'
import { DialogProvider, useDialog } from './components/Dialog'
import { checkedValue, textValue } from './components/dialogValues'
import { DiffViewer, type DiffTarget } from './components/DiffViewer'
import { RepoPicker } from './components/RepoPicker'
import type { LabelTarget } from './components/RefLabel'
import { SettingsPanel } from './components/SettingsPanel'
import { ToastProvider, useToast } from './components/Toast'
import { Toolbar, type SearchState } from './components/Toolbar'
import { ThemeProvider } from './theme/ThemeProvider'
import IconGitCompare from '~icons/lucide/git-compare'
import IconTriangleAlert from '~icons/lucide/triangle-alert'
import IconLoader from '~icons/lucide/loader-circle'
import IconGitBranch from '~icons/lucide/git-branch'
import IconArrowUp from '~icons/lucide/arrow-up'
import IconArrowDown from '~icons/lucide/arrow-down'
import IconX from '~icons/lucide/x'
import IconCheck from '~icons/lucide/check'

const DEFAULT_SPLIT_WIDTH = 520

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DialogProvider>
          <Main />
        </DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

function Main() {
  const [settings, updateSettings] = useSettings()
  const dialog = useDialog()
  const toast = useToast()

  // ----- repositories ------------------------------------------------------
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [repo, setRepo] = useState<string | null>(null)
  const activeRepo = useRef<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [selectedState, setSelected] = useState<string | null>(null)
  const [focusedState, setFocused] = useState<string | null>(null)
  const [compareState, setCompare] = useState<string | null>(null)
  const [diffState, setDiff] = useState<DiffTarget | null>(null)
  const [extraCommits, setExtraCommits] = useState(0)
  const [branches, setBranchesState] = useState<string[] | null>(null)
  const selectRepo = useCallback((path: string | null) => {
    activeRepo.current = path
    setRepo(path)
    setMenu(null)
    setBranchesState(
      path
        ? loadLocal(
            `branches:${path}`,
            null,
            (value): value is string[] | null =>
              value === null ||
              (Array.isArray(value) && value.every((branch) => typeof branch === 'string')),
          )
        : null,
    )
    setSelected(null)
    setFocused(null)
    setCompare(null)
    setDiff(null)
    setExtraCommits(0)
  }, [])
  useEffect(() => {
    api
      .repos()
      .then((r) => {
        setRepos(r.repos)
        const last = loadLocal(
          'lastRepo',
          null,
          (value): value is string | null => value === null || typeof value === 'string',
        )
        selectRepo(r.repos.find((x) => x.path === last)?.path ?? r.repos[0]?.path ?? null)
      })
      .catch((e: Error) => toast.show('error', 'Could not load repositories', e.message))
  }, [toast, selectRepo])
  useEffect(() => {
    if (repo) saveLocal('lastRepo', repo)
  }, [repo])

  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const addRepo = () => setRepoPickerOpen(true)
  const submitRepo = async (path: string) => {
    const r = await api.addRepo(path)
    setRepos(r.repos)
    if (r.added[0]) selectRepo(r.added[0].path)
    setRepoPickerOpen(false)
  }
  const restoreRepo = async (path: string, reselect: boolean) => {
    try {
      const r = await api.addRepo(path)
      setRepos(r.repos)
      if (reselect && r.added[0]) selectRepo(r.added[0].path)
    } catch (e) {
      toast.show('error', 'Could not restore repository', (e as Error).message)
    }
  }
  const removeRepo = async (path: string) => {
    const name = repos.find((r) => r.path === path)?.name ?? path
    const wasActive = activeRepo.current === path
    const r = await api.removeRepo(path)
    setRepos(r.repos)
    if (activeRepo.current === path) selectRepo(r.repos[0]?.path ?? null)
    toast.show('info', `Removed ${name} from the list`, undefined, 8000, {
      label: 'Undo',
      onClick: () => void restoreRepo(path, wasActive),
    })
  }

  // ----- graph data --------------------------------------------------------
  const setBranches = (b: string[] | null) => {
    setBranchesState(b)
    if (repo) saveLocal(`branches:${repo}`, b)
  }

  const graphRequest = useMemo<GraphRequest | null>(
    () =>
      repo
        ? {
            repo,
            maxCommits: settings.maxCommits + extraCommits,
            showRemoteBranches: settings.showRemoteBranches,
            branches,
            order: settings.order,
            showStashes: settings.showStashes,
            showTags: settings.showTags,
          }
        : null,
    [
      repo,
      settings.maxCommits,
      settings.showRemoteBranches,
      settings.order,
      settings.showStashes,
      settings.showTags,
      branches,
      extraCommits,
    ],
  )
  const { data, loading, error, version, stats, refresh } = useRepoGraph(graphRequest)

  // Auto refresh via server-sent events (debounced)
  useEffect(() => {
    if (!repo || !settings.autoRefresh) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeRepoEvents(repo, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 300)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [repo, settings.autoRefresh, refresh])

  const actions = useRepoActions(repo, data, refresh, settings)

  // ----- rows + graph layout ----------------------------------------------
  const { rows, maxLanes } = useMemo(() => {
    if (!data) return { rows: [] as TableRow[], maxLanes: 1 }
    const list: { commit: GitCommit; kind: TableRow['kind'] }[] = []
    if (settings.showUncommitted && data.uncommitted.length > 0) {
      list.push({
        kind: 'uncommitted',
        commit: {
          hash: UNCOMMITTED,
          parents: data.head ? [data.head] : [],
          author: '*',
          email: '',
          date: 0,
          committer: '*',
          committerEmail: '',
          commitDate: 0,
          subject: `Uncommitted Changes (${data.uncommitted.length})`,
        },
      })
    }
    for (const c of data.commits) list.push({ commit: c, kind: c.stash ? 'stash' : 'commit' })
    const layout = layoutGraph(list.map((r) => r.commit))
    return {
      rows: list.map((r, i) => ({ ...r, graph: layout.rows[i] })),
      maxLanes: layout.maxLanes,
    }
  }, [data, settings.showUncommitted])

  // ----- selection ---------------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [splitWidth, setSplitWidth] = useState(() =>
    loadLocal(
      'splitWidth',
      DEFAULT_SPLIT_WIDTH,
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value >= 320,
    ),
  )

  // Drop the selection if the commit disappeared (e.g. uncommitted row gone after a commit)
  const rowExists = (h: string | null) => h !== null && rows.some((r) => r.commit.hash === h)
  const selected = rowExists(selectedState) ? selectedState : null
  const compare = selected && rowExists(compareState) ? compareState : null
  const diff = selected ? diffState : null
  // The keyboard cursor; defaults to the selection (or the first row) so Tab lands in the table.
  const focused = rowExists(focusedState)
    ? focusedState
    : (selected ?? rows[0]?.commit.hash ?? null)

  // Move DOM focus after the render that made the row tabbable (and, in the inline
  // layout, moved the details row), so scrolling accounts for the final layout.
  const focusPending = useRef(false)
  const focusRow = (hash: string) => {
    focusPending.current = true
    setFocused(hash)
  }
  useEffect(() => {
    if (!focusPending.current || !focused) return
    focusPending.current = false
    const el = document.getElementById(`commit-${focused}`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  const openDetails = (hash: string) => {
    setCompare(null)
    setDiff(null)
    setSelected(hash)
  }

  const onSelect = (hash: string, e: MouseEvent) => {
    setFocused(hash)
    if (e.ctrlKey || e.metaKey) {
      if (!selected || selected === hash) {
        setSelected(hash)
        setCompare(null)
      } else if (hash === UNCOMMITTED || selected === UNCOMMITTED) {
        toast.show('info', 'Uncommitted changes cannot be compared with a commit', undefined, 3000)
      } else {
        setCompare(compare === hash ? null : hash)
      }
      return
    }
    // Clicking the selected row again keeps it open; Esc or the close button close details.
    if (hash !== selected || compare) openDetails(hash)
  }

  const onRowKeyDown = (e: ReactKeyboardEvent, hash: string) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const i = rows.findIndex((r) => r.commit.hash === hash)
    if (i < 0) return
    if (e.key === 'Enter') {
      e.preventDefault()
      openDetails(hash)
      return
    }
    const step: Record<string, number> = {
      ArrowDown: i + 1,
      j: i + 1,
      ArrowUp: i - 1,
      k: i - 1,
      Home: 0,
      End: rows.length - 1,
    }
    if (!Object.hasOwn(step, e.key)) return
    e.preventDefault()
    const target = rows[Math.min(Math.max(step[e.key], 0), rows.length - 1)].commit.hash
    focusRow(target)
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // Shift+arrows compare the selected commit (or the row the cursor left) with the new row
      const anchor = selected ?? hash
      if (anchor === UNCOMMITTED || target === UNCOMMITTED) {
        toast.show('info', 'Uncommitted changes cannot be compared with a commit', undefined, 3000)
        return
      }
      setSelected(anchor)
      setDiff(null)
      setCompare(target === anchor ? null : target)
      return
    }
    // While details are open they follow the cursor
    if (selected) openDetails(target)
  }

  const detailsMode = useMemo<DetailsMode | null>(() => {
    if (!selected) return null
    if (compare && selected !== UNCOMMITTED) {
      // Older commit (lower in the list) is "from", newer is "to"
      const iSel = rows.findIndex((r) => r.commit.hash === selected)
      const iCmp = rows.findIndex((r) => r.commit.hash === compare)
      return iSel < iCmp
        ? { kind: 'compare', from: compare, to: selected }
        : { kind: 'compare', from: selected, to: compare }
    }
    if (selected === UNCOMMITTED) return { kind: 'uncommitted' }
    return { kind: 'commit', hash: selected }
  }, [selected, compare, rows])

  // ----- context menus -----------------------------------------------------
  const openMenu = (e: MouseEvent, items: MenuEntry[]) => {
    if (items.length === 0) return
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  const onRowContextMenu = (e: MouseEvent, row: TableRow) => {
    if (row.kind === 'uncommitted') return openMenu(e, actions.uncommittedMenu())
    if (row.kind === 'stash' && row.commit.stash)
      return openMenu(e, actions.stashMenu(row.commit.stash))
    const extra: MenuEntry[] =
      selected && selected !== row.commit.hash && selected !== UNCOMMITTED
        ? [
            {
              label: `Compare with ${shortHash(selected)}`,
              icon: <IconGitCompare />,
              onClick: () => setCompare(row.commit.hash),
            },
            'separator',
          ]
        : []
    openMenu(e, actions.commitMenu(row.commit, extra))
  }
  const onRefContextMenu = (e: MouseEvent, target: LabelTarget, row: TableRow) =>
    openMenu(e, actions.refMenu(target, row.commit))

  // ----- columns -----------------------------------------------------------
  const [columns, setColumns] = useColumnLayout()
  const onHeaderContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    openMenu(e, [
      ...COLUMNS.map((c) => {
        const shown = !columns.hidden.includes(c.id)
        return {
          label: c.label,
          icon: shown ? <IconCheck /> : undefined,
          onClick: () =>
            setColumns({
              ...columns,
              hidden: shown ? [...columns.hidden, c.id] : columns.hidden.filter((h) => h !== c.id),
            }),
        }
      }),
      'separator',
      { label: 'Reset Columns', onClick: () => setColumns({ hidden: [], widths: {} }) },
    ])
  }

  // ----- search ------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const searchMatches = useMemo(() => {
    const set = new Set<string>()
    const q = query.trim().toLowerCase()
    if (!q || !data) return set
    const refNames = new Map<string, string[]>()
    for (const r of data.refs)
      refNames.set(r.hash, [...(refNames.get(r.hash) ?? []), r.name.toLowerCase()])
    for (const r of rows) {
      const c = r.commit
      if (
        c.subject.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.hash.toLowerCase().startsWith(q) ||
        (refNames.get(c.hash) ?? []).some((n) => n.includes(q))
      ) {
        set.add(c.hash)
      }
    }
    return set
  }, [query, rows, data])
  const matchList = useMemo(
    () => rows.filter((r) => searchMatches.has(r.commit.hash)).map((r) => r.commit.hash),
    [rows, searchMatches],
  )
  const setQuery = (q: string) => {
    setQueryState(q)
    setMatchIndex(0)
  }
  const currentMatch = matchList.length
    ? matchList[Math.min(matchIndex, matchList.length - 1)]
    : null
  useEffect(() => {
    if (currentMatch)
      document.getElementById(`commit-${currentMatch}`)?.scrollIntoView({ block: 'center' })
  }, [currentMatch])
  const search: SearchState = {
    query,
    setQuery,
    count: matchList.length,
    index: Math.min(matchIndex, Math.max(0, matchList.length - 1)),
    next: () => setMatchIndex((i) => (matchList.length ? (i + 1) % matchList.length : 0)),
    prev: () =>
      setMatchIndex((i) => (matchList.length ? (i - 1 + matchList.length) % matchList.length : 0)),
    open: searchOpen,
    setOpen: (o) => {
      setSearchOpen(o)
      if (!o) setQuery('')
    },
  }

  const goToHead = () => {
    const head = data?.head
    if (!head || !rowExists(head)) return
    focusRow(head)
    if (selected) openDetails(head)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !typing) {
        e.preventDefault()
        setSearchOpen(true)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h' && !typing) {
        e.preventDefault()
        goToHead()
      } else if (e.key === 'F5') {
        e.preventDefault()
        refresh()
      } else if (e.key === 'Escape' && !typing) {
        if (diff) setDiff(null)
        else if (menu) setMenu(null)
        else if (compare) setCompare(null)
        else if (selected) setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ----- remotes -----------------------------------------------------------
  const addRemote = async () => {
    const v = await dialog.open({
      title: 'Add Remote',
      fields: [
        {
          type: 'text',
          name: 'name',
          label: 'Name',
          default: data?.remotes.length ? '' : 'origin',
        },
        { type: 'text', name: 'url', label: 'URL', placeholder: 'https://… or git@…' },
        { type: 'checkbox', name: 'fetch', label: 'Fetch after adding', default: true },
      ],
      submitLabel: 'Add Remote',
      validate: (val) =>
        !String(val.name).trim()
          ? 'Name is required'
          : !String(val.url).trim()
            ? 'URL is required'
            : null,
    })
    if (!v) return
    const ok = await actions.run(`Add remote ${v.name}`, 'addRemote', {
      name: textValue(v, 'name'),
      url: textValue(v, 'url'),
    })
    if (ok && checkedValue(v, 'fetch'))
      await actions.run(`Fetch ${v.name}`, 'fetch', {
        remote: textValue(v, 'name'),
        prune: settings.fetchAndPrune,
      })
  }
  const editRemote = async (name: string) => {
    const r = data?.remotes.find((x) => x.name === name)
    const v = await dialog.open({
      title: `Edit Remote ${name}`,
      fields: [
        { type: 'text', name: 'newName', label: 'Name', default: name },
        { type: 'text', name: 'url', label: 'URL', default: r?.url ?? '' },
      ],
      submitLabel: 'Save',
    })
    if (v)
      await actions.run(`Edit remote ${name}`, 'editRemote', {
        name,
        newName: textValue(v, 'newName'),
        url: textValue(v, 'url'),
      })
  }
  const removeRemote = async (name: string) => {
    const ok = await dialog.confirm(
      `Remove remote ${name}?`,
      'Remote-tracking branches for this remote will be deleted.',
      { submitLabel: 'Remove', danger: true },
    )
    if (ok) await actions.run(`Remove remote ${name}`, 'removeRemote', { name })
  }

  // ----- render ------------------------------------------------------------
  const state = data?.state
  const inProgress = state
    ? state.mergeInProgress
      ? 'merge'
      : state.rebaseInProgress
        ? 'rebase'
        : state.cherryPickInProgress
          ? 'cherry-pick'
          : state.revertInProgress
            ? 'revert'
            : null
    : null

  const splitMode = settings.commitView === 'split'
  const detailsElement = (layout: 'row' | 'column') =>
    detailsMode && repo && data ? (
      <CommitDetails
        key={repo}
        repo={repo}
        mode={detailsMode}
        data={data}
        version={version}
        actions={actions}
        layout={layout}
        onOpenDiff={setDiff}
        onSelectCommit={(h) => {
          setCompare(null)
          setSelected(h)
          setFocused(h)
          document.getElementById(`commit-${h}`)?.scrollIntoView({ block: 'center' })
        }}
        onClose={() => {
          setSelected(null)
          setCompare(null)
        }}
      />
    ) : null
  const panelTitle =
    detailsMode?.kind === 'uncommitted'
      ? 'Uncommitted Changes'
      : detailsMode?.kind === 'compare'
        ? `Compare ${shortHash(detailsMode.from)} → ${shortHash(detailsMode.to)}`
        : detailsMode?.kind === 'commit'
          ? (rows.find((r) => r.commit.hash === detailsMode.hash)?.commit.subject ??
            shortHash(detailsMode.hash))
          : ''

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        repos={repos}
        repo={repo}
        onSelectRepo={selectRepo}
        onAddRepo={addRepo}
        onRemoveRepo={(p) => void removeRepo(p)}
        data={data}
        branches={branches}
        onBranchesChange={setBranches}
        settings={settings}
        updateSettings={updateSettings}
        search={search}
        loading={loading}
        onRefresh={refresh}
        onFetch={() => void actions.fetchAll()}
        onPull={() => void actions.pull()}
        onPullOptions={() => void actions.pullWithOptions()}
        onPush={() => void actions.push()}
        onPushOptions={() => void actions.pushWithOptions()}
        onStash={() => void actions.stash()}
        onCreateBranch={() => data?.head && void actions.createBranchAt(data.head)}
        onAddRemote={() => void addRemote()}
        onEditRemote={(n) => void editRemote(n)}
        onRemoveRemote={(n) => void removeRemote(n)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {inProgress && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-warning/15 text-warning shrink-0">
          <IconTriangleAlert className="w-4 h-4" />
          <span className="flex-1">
            A <b>{inProgress}</b> is in progress. Resolve any conflicts, stage the resolved files,
            then continue or abort.
          </span>
          {inProgress !== 'merge' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void actions.run(`Continue ${inProgress}`, 'continue', { op: inProgress })
                }
              >
                Continue
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void actions.run(`Skip ${inProgress}`, 'skip', { op: inProgress })}
              >
                Skip
              </button>
            </>
          )}
          {inProgress === 'merge' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void actions.run('Commit merge', 'commit', { messageMode: 'prepared' })
              }
              title="Commit the merge with the default message (stage resolved files first)"
            >
              Commit Merge
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void actions.run(`Abort ${inProgress}`, 'abort', { op: inProgress })}
          >
            Abort
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 relative flex">
        <div className="flex-1 min-w-0 overflow-auto">
          {error && (
            <div className="p-4 text-danger flex flex-col gap-2">
              <div className="whitespace-pre-wrap">{error}</div>
              <button type="button" className="btn btn-secondary self-start" onClick={refresh}>
                Retry
              </button>
            </div>
          )}
          {!error && !data && repo && (
            <div className="p-4 text-fg-muted flex items-center gap-2">
              <IconLoader className="animate-spin" /> Loading repository…
            </div>
          )}
          {!repo && repos.length === 0 && (
            <div className="p-6 text-fg-muted flex flex-col gap-3 items-start">
              <div>
                No repositories registered. Start the server inside a git repository, pass paths on
                the command line, or add one now.
              </div>
              <button type="button" className="btn" onClick={addRepo}>
                Add repository…
              </button>
            </div>
          )}
          {data && repo && (
            <CommitTable
              rows={rows}
              maxLanes={maxLanes}
              data={data}
              settings={settings}
              columns={columns}
              onColumnsChange={setColumns}
              onHeaderContextMenu={onHeaderContextMenu}
              selected={selected}
              compare={compare}
              focused={focused}
              searchMatches={searchMatches}
              currentMatch={currentMatch}
              onSelect={onSelect}
              onRowKeyDown={onRowKeyDown}
              onContextMenu={onRowContextMenu}
              onRefContextMenu={onRefContextMenu}
              onBranchDrop={(source, target, e) =>
                openMenu(e, actions.branchDropMenu(source, target))
              }
              moreAvailable={data.moreAvailable}
              loading={loading}
              onLoadMore={() => setExtraCommits((n) => n + settings.maxCommits)}
              stats={stats}
              renderDetails={() => (splitMode ? null : detailsElement('row'))}
            />
          )}
        </div>
        {splitMode && data && repo && (
          <aside
            className="shrink-0 flex flex-col border-l border-border bg-bg-2 relative"
            style={{ width: splitWidth }}
          >
            <div
              className="absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize z-10 hover:bg-focus/40"
              title="Drag to resize, double-click to reset"
              onDoubleClick={() => {
                setSplitWidth(DEFAULT_SPLIT_WIDTH)
                saveLocal('splitWidth', DEFAULT_SPLIT_WIDTH)
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startW = splitWidth
                const onMove = (ev: globalThis.MouseEvent) => {
                  const w = Math.min(
                    Math.max(320, startW + (startX - ev.clientX)),
                    window.innerWidth - 400,
                  )
                  setSplitWidth(w)
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                  setSplitWidth((w) => {
                    saveLocal('splitWidth', w)
                    return w
                  })
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            <div className="flex items-center gap-2 px-3 h-8 border-b border-border shrink-0">
              <span className="font-semibold truncate flex-1" title={panelTitle}>
                {panelTitle || 'Commit details'}
              </span>
              {detailsMode && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Close details (Esc)"
                  onClick={() => {
                    setSelected(null)
                    setCompare(null)
                  }}
                >
                  <IconX className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {detailsElement('column') ?? (
                <div className="p-4 text-fg-dim">
                  Select a commit to see its details. Ctrl/Cmd+click a second commit to compare.
                </div>
              )}
            </div>
          </aside>
        )}
        {diff && repo && (
          <DiffViewer
            key={`${diff.from}:${diff.to}:${diff.file.path}`}
            repo={repo}
            target={diff}
            diffStyle={settings.diffStyle}
            onDiffStyleChange={(s) => updateSettings({ diffStyle: s })}
            onClose={() => setDiff(null)}
          />
        )}
      </div>

      <div
        className="flex items-center gap-3 px-3 h-6 text-xs border-t border-border shrink-0"
        style={{
          background: 'var(--vscode-statusBar-background)',
          color: 'var(--vscode-statusBar-foreground)',
        }}
      >
        {data && (
          <>
            <span className="flex items-center gap-1" title="Current branch">
              <IconGitBranch className="w-3 h-3" />
              {data.currentBranch ??
                (data.head ? `HEAD detached at ${shortHash(data.head)}` : 'no commits yet')}
            </span>
            {data.upstream && (
              <span className="flex items-center gap-1" title={`Upstream: ${data.upstream.name}`}>
                {data.upstream.name}
                <IconArrowUp className="w-3 h-3" />
                {data.upstream.ahead}
                <IconArrowDown className="w-3 h-3" />
                {data.upstream.behind}
              </span>
            )}
            <span>
              {pluralize(data.commits.length, 'commit')}
              {data.moreAvailable ? '+' : ''}
            </span>
            {data.uncommitted.length > 0 && (
              <span>{pluralize(data.uncommitted.length, 'uncommitted change')}</span>
            )}
            {data.stashes.length > 0 && (
              <span>{pluralize(data.stashes.length, 'stash', 'stashes')}</span>
            )}
          </>
        )}
        <span className="flex-1" />
        <span className="truncate opacity-70 mono">{repo}</span>
      </div>

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {repoPickerOpen && (
        <RepoPicker
          initialPath={repo && parentPath(repo)}
          onSubmit={submitRepo}
          onClose={() => setRepoPickerOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          userName={data?.userName ?? ''}
          userEmail={data?.userEmail ?? ''}
          onEditUser={() => void actions.editUser()}
        />
      )}
    </div>
  )
}
