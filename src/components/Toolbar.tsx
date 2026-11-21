import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { GITHUB_REPO_NAME_RE, githubWebUrl } from '@shared/github'
import type { GitHubRepoMatch, GraphData, RepoInfo } from '@shared/types'
import { groupByFrecency } from '@/lib/frecency'
import type { Settings } from '@/lib/settings'
import { api } from '@/api'
import { useToast } from './Toast'
import { Dropdown, DropdownItem } from './Dropdown'
import { BranchFilter } from './BranchFilter'
import { RepoIcon } from './RepoIcon'
import IconFolderGit2 from '~icons/lucide/folder-git-2'
import IconSearch from '~icons/lucide/search'
import IconRefreshCw from '~icons/lucide/refresh-cw'
import IconCloudDownload from '~icons/lucide/cloud-download'
import IconDownload from '~icons/lucide/download'
import IconUpload from '~icons/lucide/upload'
import IconSettings from '~icons/lucide/settings'
import IconPlus from '~icons/lucide/plus'
import IconFolderPlus from '~icons/lucide/folder-plus'
import IconX from '~icons/lucide/x'
import IconChevronUp from '~icons/lucide/chevron-up'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconArchive from '~icons/lucide/archive'
import IconGitBranchPlus from '~icons/lucide/git-branch-plus'
import IconCloud from '~icons/lucide/cloud'
import IconCloudUpload from '~icons/lucide/cloud-upload'
import IconGithub from '~icons/lucide/github'
import IconTrash2 from '~icons/lucide/trash-2'
import IconPencil from '~icons/lucide/pencil'
import IconLoader from '~icons/lucide/loader-circle'

export interface SearchState {
  query: string
  setQuery: (q: string) => void
  count: number
  index: number
  next: () => void
  prev: () => void
  goToCommit?: () => void
  open: boolean
  setOpen: (o: boolean) => void
}

interface Props {
  repos: RepoInfo[]
  repo: string | null
  onSelectRepo: (path: string) => void
  onAddRepo: () => void
  onSubmitRepo: (path: string) => Promise<void>
  /** Initialize a git repository in a folder that has none and open it */
  onInitRepo: (path: string) => Promise<void>
  /** Clone a GitHub repository into an empty folder and open it */
  onCloneRepo: (path: string, repo: GitHubRepoMatch) => Promise<void>
  onRepoContextMenu: (path: string, x: number, y: number) => void
  repoContextMenuOpen?: boolean
  data: GraphData | null
  branches: string[] | null
  onBranchesChange: (b: string[] | null) => void
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  search: SearchState
  loading: boolean
  fetching: boolean
  pulling: boolean
  pushing: boolean
  onRefresh: () => void
  onFetch: () => void
  /** Pull from the upstream (or ask where to pull from when there is none) */
  onPull: () => void
  onPullOptions: () => void
  /** Push to the upstream (or ask where to push when there is none) */
  onPush: () => void
  onPushOptions: () => void
  onStash: () => void
  onCreateBranch: () => void
  onAddRemote: () => void
  onEditRemote: (name: string) => void
  onRemoveRemote: (name: string) => void
  /** Create a GitHub repository for the current repository and push to it */
  onPublish: () => void
  publishing: boolean
  onOpenSettings: () => void
}

export function Toolbar(p: Props) {
  const searchInput = useRef<HTMLInputElement>(null)
  const current = p.repos.find((r) => r.path === p.repo)
  const upstream = p.data?.upstream

  useEffect(() => {
    if (p.search.open) searchInput.current?.focus()
  }, [p.search.open])

  return (
    <div className="flex items-center gap-2 px-2 h-10 border-b border-border bg-bg-2 shrink-0 flex-wrap">
      <Dropdown
        icon={
          current ? (
            <RepoIcon repo={current} eager />
          ) : (
            <IconFolderGit2 className="w-4 h-4 shrink-0" />
          )
        }
        label={current?.name ?? 'Select repository'}
        title={current?.path ?? 'Repository'}
        panelClassName="w-[360px] max-w-[calc(100vw-16px)] !min-w-0 overflow-x-hidden"
        contextMenuOpen={p.repoContextMenuOpen}
        onTriggerContextMenu={
          current ? (x, y) => p.onRepoContextMenu(current.path, x, y) : undefined
        }
      >
        {(close) => (
          <RepositoryFilter
            repos={p.repos}
            repo={p.repo}
            onSelectRepo={p.onSelectRepo}
            onAddRepo={p.onAddRepo}
            onSubmitRepo={p.onSubmitRepo}
            onInitRepo={p.onInitRepo}
            onCloneRepo={p.onCloneRepo}
            onRepoContextMenu={p.onRepoContextMenu}
            close={close}
          />
        )}
      </Dropdown>

      <BranchFilter
        key={p.repo}
        data={p.data}
        branches={p.branches}
        onBranchesChange={p.onBranchesChange}
        showRemote={p.settings.showRemoteBranches}
        onShowRemoteChange={(v) => p.updateSettings({ showRemoteBranches: v })}
      />

      <span className="flex-1" />

      {p.search.open ? (
        <div className="flex items-center gap-1 bg-input border border-border rounded px-1 h-[26px]">
          <IconSearch className="w-3.5 h-3.5 text-fg-muted" />
          <input
            ref={searchInput}
            type="text"
            className="!border-0 !bg-transparent !p-0 w-56"
            placeholder="Find (message, author, hash, ref)"
            value={p.search.query}
            onChange={(e) => p.search.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) p.search.prev()
                else if (p.search.goToCommit) p.search.goToCommit()
                else p.search.next()
              } else if (e.key === 'Escape') {
                p.search.setOpen(false)
              }
            }}
          />
          <span className="text-xs text-fg-muted whitespace-nowrap min-w-[52px] text-center">
            {p.search.query
              ? p.search.count
                ? `${p.search.index + 1} of ${p.search.count}`
                : p.search.goToCommit
                  ? 'Enter to go to commit'
                  : 'No results'
              : ''}
          </span>
          <button
            type="button"
            className="icon-btn !w-5 !h-5"
            title="Previous match (Shift+Enter)"
            disabled={!p.search.count}
            onClick={p.search.prev}
          >
            <IconChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="icon-btn !w-5 !h-5"
            title={p.search.goToCommit ? 'Go to commit (Enter)' : 'Next match (Enter)'}
            disabled={!p.search.count && !p.search.goToCommit}
            onClick={p.search.goToCommit ?? p.search.next}
          >
            <IconChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="icon-btn !w-5 !h-5"
            title="Close (Esc)"
            onClick={() => p.search.setOpen(false)}
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="icon-btn"
          title="Find (Ctrl+F)"
          onClick={() => p.search.setOpen(true)}
        >
          <IconSearch className="w-4 h-4" />
        </button>
      )}

      <button
        type="button"
        className="icon-btn"
        title="Create branch from HEAD"
        disabled={!p.data?.head}
        onClick={p.onCreateBranch}
      >
        <IconGitBranchPlus className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Stash changes"
        disabled={!p.data || p.data.uncommitted.length === 0}
        onClick={p.onStash}
      >
        <IconArchive className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Fetch from all remotes"
        disabled={!p.data || p.data.remotes.length === 0 || p.fetching}
        aria-busy={p.fetching}
        onClick={p.onFetch}
      >
        {p.fetching ? (
          <IconLoader className="w-4 h-4 animate-spin" />
        ) : (
          <IconCloudDownload className="w-4 h-4" />
        )}
      </button>
      <SplitButton
        icon={<IconDownload className="w-4 h-4" />}
        title={upstream ? `Pull from ${upstream.name}` : 'Pull…'}
        optionsTitle="Pull with options (remote, branch, rebase)…"
        count={upstream?.behind}
        busy={p.pulling}
        disabled={!p.data || p.data.remotes.length === 0}
        onClick={p.onPull}
        onOptions={p.onPullOptions}
      />
      {p.data && p.data.remotes.length === 0 ? (
        // Without remotes there is nowhere to push: offer to publish instead.
        <button
          type="button"
          className="btn btn-secondary !h-[26px] !px-2 gap-1.5"
          title="Create a public or private GitHub repository and push to it"
          disabled={p.publishing}
          aria-busy={p.publishing}
          onClick={p.onPublish}
        >
          {p.publishing ? (
            <IconLoader className="w-4 h-4 animate-spin" />
          ) : (
            <IconCloudUpload className="w-4 h-4" />
          )}
          Publish
        </button>
      ) : (
        <SplitButton
          icon={<IconUpload className="w-4 h-4" />}
          title={upstream && p.data?.currentBranch ? `Push to ${upstream.name}` : 'Push…'}
          optionsTitle="Push with options (remote, set upstream, force with lease)…"
          count={upstream?.ahead}
          busy={p.pushing}
          disabled={!p.data || !p.data.currentBranch}
          onClick={p.onPush}
          onOptions={p.onPushOptions}
        />
      )}

      <Dropdown
        icon={<IconCloud className="w-4 h-4" />}
        label="Remotes"
        align="right"
        title="Manage remotes"
      >
        {(close) => (
          <div className="py-1 min-w-[320px]">
            {(p.data?.remotes ?? []).map((r) => {
              const webUrl = githubWebUrl(r.url)
              return (
                <div key={r.name} className="flex items-center px-3 py-1 gap-2">
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs opacity-60 truncate mono">{r.url}</span>
                  </span>
                  {webUrl && (
                    <a
                      className="icon-btn"
                      href={webUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${webUrl.slice('https://'.length)} on GitHub`}
                      onClick={close}
                    >
                      <IconGithub className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title="Edit remote"
                    onClick={() => {
                      close()
                      p.onEditRemote(r.name)
                    }}
                  >
                    <IconPencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove remote"
                    onClick={() => {
                      close()
                      p.onRemoveRemote(r.name)
                    }}
                  >
                    <IconTrash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
            {(p.data?.remotes.length ?? 0) === 0 && (
              <div className="px-3 py-1 text-fg-dim">No remotes configured</div>
            )}
            <div className="context-menu-sep" />
            <DropdownItem
              onClick={() => {
                close()
                p.onAddRemote()
              }}
            >
              <IconPlus className="w-4 h-4" /> Add remote…
            </DropdownItem>
            <DropdownItem
              onClick={() => {
                close()
                p.onPublish()
              }}
            >
              <IconGithub className="w-4 h-4" /> Publish to GitHub…
            </DropdownItem>
          </div>
        )}
      </Dropdown>

      <button
        type="button"
        className="icon-btn"
        title="Refresh (F5)"
        onClick={p.onRefresh}
        disabled={p.loading}
      >
        {p.loading ? (
          <IconLoader className="w-4 h-4 animate-spin" />
        ) : (
          <IconRefreshCw className="w-4 h-4" />
        )}
      </button>
      <button type="button" className="icon-btn" title="Settings" onClick={p.onOpenSettings}>
        <IconSettings className="w-4 h-4" />
      </button>
    </div>
  )
}

/** A row of the repository filter: a repository, or an action for a pasted folder path. */
type FilterOption =
  | { key: string; kind: 'repo'; repo: RepoInfo }
  | { key: string; kind: 'clone'; match: GitHubRepoMatch }
  | { key: string; kind: 'init' }

const repoKey = (path: string) => `repo:${path}`

function RepositoryFilter(
  p: Pick<
    Props,
    | 'repos'
    | 'repo'
    | 'onSelectRepo'
    | 'onAddRepo'
    | 'onSubmitRepo'
    | 'onInitRepo'
    | 'onCloneRepo'
    | 'onRepoContextMenu'
  > & {
    close: () => void
  },
) {
  const [query, setQuery] = useState('')
  const [highlightedKey, setHighlightedKey] = useState(p.repo === null ? null : repoKey(p.repo))
  const [checked, setChecked] = useState<{
    path: string
    repo: RepoInfo | null
    canInit: boolean
    canClone: boolean
    error?: string
  } | null>(null)
  const [github, setGitHub] = useState<{ path: string; matches: GitHubRepoMatch[] } | null>(null)
  /** Key of the option being added, initialized or cloned */
  const [submitting, setSubmitting] = useState<string | null>(null)
  const busy = submitting !== null
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const highlightedRow = useRef<HTMLDivElement>(null)
  const path = query.trim().replace(/^(["'])(.*)\1$/, '$2')
  const isPath = /^(?:[a-zA-Z]:[\\/]|[\\/]|\.{1,2}[\\/])/.test(path)
  const checking = isPath && checked?.path !== path
  const current = isPath && checked?.path === path ? checked : null
  const resolvedRepo = current?.repo ?? null
  const folderName =
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? path
  const githubName = current?.canClone && GITHUB_REPO_NAME_RE.test(folderName) ? folderName : null
  const checkingGitHub = githubName !== null && github?.path !== path
  const cloneMatches = githubName !== null && github?.path === path ? github.matches : []
  const offerInit = !!current && !current.repo && current.canInit
  const newRepo = resolvedRepo && !p.repos.some((r) => r.path === resolvedRepo.path)
  const needle = path.toLowerCase()
  // Ranked once per opening, so rows do not move while the menu is open.
  const groupedRepos = useMemo(() => groupByFrecency(p.repos), [p.repos])
  const matchesRepo = (r: RepoInfo) =>
    r.path === resolvedRepo?.path ||
    r.name.toLowerCase().includes(needle) ||
    r.path.toLowerCase().includes(needle)
  const recentRepos = groupedRepos.recent.filter(matchesRepo)
  const otherRepos = groupedRepos.others.filter(matchesRepo)
  if (newRepo) otherRepos.push(resolvedRepo)
  const options: FilterOption[] = [
    ...[...recentRepos, ...otherRepos].map((repo) => ({
      key: repoKey(repo.path),
      kind: 'repo' as const,
      repo,
    })),
    ...(offerInit ? [{ key: 'init', kind: 'init' as const }] : []),
    // Matches arrive after Initialize is usable; listing them below it keeps
    // the rows and the default highlight from moving under the user.
    ...cloneMatches.map((match) => ({
      key: `clone:${match.fullName}`,
      kind: 'clone' as const,
      match,
    })),
  ]
  const highlighted =
    options.find((o) => o.key === highlightedKey) ??
    (resolvedRepo ? options.find((o) => o.key === repoKey(resolvedRepo.path)) : undefined) ??
    options[0]

  useEffect(() => {
    if (!isPath) return
    let stale = false
    const timer = setTimeout(() => {
      api.resolveRepo(path).then(
        ({ repo, canInit, canClone }) => !stale && setChecked({ path, repo, canInit, canClone }),
        (e: Error) =>
          !stale &&
          setChecked({ path, repo: null, canInit: false, canClone: false, error: e.message }),
      )
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [path, isPath])

  useEffect(() => {
    if (githubName === null) return
    let stale = false
    api.githubRepos(githubName).then(
      ({ repos }) => !stale && setGitHub({ path, matches: repos }),
      () => !stale && setGitHub({ path, matches: [] }),
    )
    return () => {
      stale = true
    }
  }, [path, githubName])

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    if (busy) return
    setSubmitting(key)
    try {
      await action()
      p.close()
    } catch (e) {
      toast.show('error', failure, (e as Error).message)
    } finally {
      setSubmitting(null)
    }
  }

  const choose = (option: FilterOption) => {
    if (busy) return
    if (option.kind === 'init') {
      void run(option.key, () => p.onInitRepo(path), 'Could not initialize repository')
    } else if (option.kind === 'clone') {
      void run(
        option.key,
        () => p.onCloneRepo(path, option.match),
        `Could not clone ${option.match.fullName}`,
      )
    } else if (newRepo && option.repo.path === resolvedRepo?.path) {
      void run(option.key, () => p.onSubmitRepo(option.repo.path), 'Could not add repository')
    } else {
      p.close()
      p.onSelectRepo(option.repo.path)
    }
  }

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    const row = highlightedRow.current
    const panel = row?.closest<HTMLElement>('.dropdown-panel')
    const header = input.current?.parentElement
    if (!row || !panel || !header) return
    const bounds = row.getBoundingClientRect()
    const top = header.getBoundingClientRect().bottom
    const bottom = panel.getBoundingClientRect().bottom
    if (bounds.top < top) panel.scrollTop -= top - bounds.top
    else if (bounds.bottom > bottom) panel.scrollTop += bounds.bottom - bottom
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- selection and filtering move the highlighted row
  }, [highlighted?.key, query])

  const renderOption = (option: FilterOption) => {
    const active = option.key === highlighted?.key
    const ref = active ? highlightedRow : undefined
    const spinner = <IconLoader className="w-4 h-4 shrink-0 animate-spin" />
    if (option.kind !== 'repo') {
      return (
        <div key={option.key} ref={ref}>
          <DropdownItem active={active} disabled={busy} onClick={() => choose(option)}>
            {submitting === option.key ? (
              spinner
            ) : option.kind === 'clone' ? (
              <IconGithub className="w-4 h-4 shrink-0" />
            ) : (
              <IconFolderPlus className="w-4 h-4 shrink-0" />
            )}
            <span className="flex flex-col min-w-0" title={path}>
              <span className="truncate">
                {option.kind === 'clone'
                  ? `Clone ${option.match.fullName}`
                  : `Initialize ${folderName}`}
              </span>
              <span className="text-xs opacity-60 truncate mono">{path}</span>
            </span>
          </DropdownItem>
        </div>
      )
    }
    const r = option.repo
    const adding = newRepo && r.path === resolvedRepo?.path
    return (
      <div
        key={option.key}
        ref={ref}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (adding) return
          p.onRepoContextMenu(r.path, e.clientX, e.clientY)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
          e.preventDefault()
          e.stopPropagation()
          if (adding) return
          const rect = e.currentTarget.getBoundingClientRect()
          p.onRepoContextMenu(r.path, rect.left, rect.bottom)
        }}
      >
        <DropdownItem
          className="min-w-0"
          active={active}
          disabled={busy}
          onClick={() => choose(option)}
        >
          {adding &&
            (submitting === option.key ? spinner : <IconPlus className="w-4 h-4 shrink-0" />)}
          <RepoIcon repo={r} />
          <span className="flex flex-col min-w-0" title={r.path}>
            <span className="truncate">{adding ? `Add ${r.name}` : r.name}</span>
            <span className="text-xs opacity-60 truncate mono">{r.path}</span>
          </span>
        </DropdownItem>
      </div>
    )
  }

  return (
    <div className="pb-1 min-w-0 w-full">
      <div className="sticky top-0 z-10 px-2 pt-2 pb-1.5 bg-[var(--vscode-dropdown-background)] border-b border-border">
        <input
          ref={input}
          type="text"
          className="w-full"
          placeholder="Search repositories or paste a path"
          aria-label="Search repositories"
          value={query}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlightedKey(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              e.stopPropagation()
              if (!options.length) return
              const index = options.findIndex((o) => o.key === highlighted?.key)
              const step = e.key === 'ArrowDown' ? 1 : -1
              const next = (index + step + options.length) % options.length
              setHighlightedKey(options[next].key)
              return
            }
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            if (highlighted) choose(highlighted)
          }}
        />
      </div>
      <DropdownItem
        disabled={busy}
        onClick={() => {
          p.close()
          p.onAddRepo()
        }}
      >
        <IconPlus className="w-4 h-4" /> Add repository…
      </DropdownItem>
      <div className="context-menu-sep" role="separator" />
      {recentRepos.length > 0 && (
        <>
          <h2 className="px-3 py-1 text-xs text-fg-dim uppercase">Recent repositories</h2>
          {options.slice(0, recentRepos.length).map(renderOption)}
          <div className="context-menu-sep" role="separator" />
        </>
      )}
      {options.slice(recentRepos.length).map(renderOption)}
      {(checking || checkingGitHub) && (
        <div role="status" className="px-3 py-1 text-fg-dim flex items-center gap-2">
          <IconLoader className="w-4 h-4 animate-spin" />{' '}
          {checking ? 'Checking repository…' : `Looking for ${folderName} on GitHub…`}
        </div>
      )}
      {options.length === 0 && !checking && !checkingGitHub && (
        <div className="px-3 py-1 text-fg-dim">
          {isPath
            ? checked?.error
              ? 'Could not check repository path'
              : 'No Git repository at this path'
            : needle
              ? 'No matching repositories'
              : 'No repositories'}
        </div>
      )}
    </div>
  )
}

/** An icon button that acts immediately, with a narrow chevron that opens the options dialog. */
function SplitButton(p: {
  icon: ReactNode
  title: string
  optionsTitle: string
  count?: number
  busy: boolean
  disabled: boolean
  onClick: () => void
  onOptions: () => void
}) {
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        className="icon-btn relative !rounded-r-none"
        title={p.title}
        disabled={p.disabled || p.busy}
        aria-busy={p.busy}
        onClick={p.onClick}
      >
        {p.busy ? <IconLoader className="w-4 h-4 animate-spin" /> : p.icon}
        {!!p.count && p.count > 0 && (
          <span className="badge absolute -top-1 -right-1 !h-4 !min-w-4 !px-1 !text-[10px]">
            {p.count}
          </span>
        )}
      </button>
      <button
        type="button"
        className="icon-btn !w-3.5 !rounded-l-none"
        title={p.optionsTitle}
        aria-label={p.optionsTitle}
        disabled={p.disabled || p.busy}
        onClick={p.onOptions}
      >
        <IconChevronDown className="w-3 h-3 opacity-70" />
      </button>
    </span>
  )
}
