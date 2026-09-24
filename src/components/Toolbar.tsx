import { useEffect, useRef, type ReactNode } from 'react'
import type { GraphData, RepoInfo } from '@shared/types'
import type { Settings } from '@/lib/settings'
import { Dropdown, DropdownItem } from './Dropdown'
import IconFolderGit2 from '~icons/lucide/folder-git-2'
import IconGitBranch from '~icons/lucide/git-branch'
import IconSearch from '~icons/lucide/search'
import IconRefreshCw from '~icons/lucide/refresh-cw'
import IconCloudDownload from '~icons/lucide/cloud-download'
import IconDownload from '~icons/lucide/download'
import IconUpload from '~icons/lucide/upload'
import IconSettings from '~icons/lucide/settings'
import IconPlus from '~icons/lucide/plus'
import IconX from '~icons/lucide/x'
import IconChevronUp from '~icons/lucide/chevron-up'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconArchive from '~icons/lucide/archive'
import IconGitBranchPlus from '~icons/lucide/git-branch-plus'
import IconCloud from '~icons/lucide/cloud'
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
  open: boolean
  setOpen: (o: boolean) => void
}

interface Props {
  repos: RepoInfo[]
  repo: string | null
  onSelectRepo: (path: string) => void
  onAddRepo: () => void
  onRemoveRepo: (path: string) => void
  data: GraphData | null
  branches: string[] | null
  onBranchesChange: (b: string[] | null) => void
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  search: SearchState
  loading: boolean
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
  onOpenSettings: () => void
}

export function Toolbar(p: Props) {
  const searchInput = useRef<HTMLInputElement>(null)
  const current = p.repos.find((r) => r.path === p.repo)
  const localBranches = (p.data?.refs ?? []).filter((r) => r.type === 'head')
  const remoteBranches = (p.data?.refs ?? []).filter((r) => r.type === 'remote')
  const allSelected = p.branches === null
  const upstream = p.data?.upstream

  useEffect(() => {
    if (p.search.open) searchInput.current?.focus()
  }, [p.search.open])

  const toggleBranch = (name: string) => {
    if (p.branches === null) {
      p.onBranchesChange([name])
      return
    }
    const next = p.branches.includes(name)
      ? p.branches.filter((b) => b !== name)
      : [...p.branches, name]
    p.onBranchesChange(next.length === 0 ? null : next)
  }

  const branchesLabel = allSelected
    ? 'Branches: Show All'
    : p.branches!.length === 1
      ? `Branch: ${p.branches![0]}`
      : `Branches: ${p.branches!.length} selected`

  return (
    <div className="flex items-center gap-2 px-2 h-10 border-b border-border bg-bg-2 shrink-0 flex-wrap">
      <Dropdown
        icon={<IconFolderGit2 className="w-4 h-4 shrink-0" />}
        label={current?.name ?? 'Select repository'}
        title={current?.path ?? 'Repository'}
      >
        {(close) => (
          <div className="py-1 min-w-[300px]">
            {p.repos.map((r) => (
              <div key={r.path} className="flex items-stretch">
                <DropdownItem
                  className="flex-1"
                  active={r.path === p.repo}
                  onClick={() => {
                    close()
                    p.onSelectRepo(r.path)
                  }}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="truncate">{r.name}</span>
                    <span className="text-xs opacity-60 truncate mono">{r.path}</span>
                  </span>
                </DropdownItem>
                <button
                  type="button"
                  className="icon-btn self-center ml-3 mr-1 hover:!text-danger"
                  title="Remove from list"
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                    p.onRemoveRepo(r.path)
                  }}
                >
                  <IconX className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="context-menu-sep" />
            <DropdownItem
              onClick={() => {
                close()
                p.onAddRepo()
              }}
            >
              <IconPlus className="w-4 h-4" /> Add repository…
            </DropdownItem>
          </div>
        )}
      </Dropdown>

      <Dropdown
        icon={<IconGitBranch className="w-4 h-4 shrink-0" />}
        label={branchesLabel}
        title="Filter the graph to selected branches"
      >
        {() => (
          <div className="py-1 min-w-[260px]">
            <DropdownItem active={allSelected} onClick={() => p.onBranchesChange(null)}>
              <input type="checkbox" readOnly checked={allSelected} /> Show All
            </DropdownItem>
            <div className="context-menu-sep" />
            {localBranches.map((b) => (
              <DropdownItem key={b.name} onClick={() => toggleBranch(b.name)}>
                <input
                  type="checkbox"
                  readOnly
                  checked={!allSelected && p.branches!.includes(b.name)}
                />
                <span className={`truncate ${b.name === p.data?.currentBranch ? 'font-bold' : ''}`}>
                  {b.name}
                </span>
              </DropdownItem>
            ))}
            {p.settings.showRemoteBranches && remoteBranches.length > 0 && (
              <>
                <div className="context-menu-sep" />
                <div className="px-3 py-1 text-xs text-fg-dim uppercase">Remote branches</div>
                {remoteBranches.map((b) => (
                  <DropdownItem key={b.name} onClick={() => toggleBranch(b.name)}>
                    <input
                      type="checkbox"
                      readOnly
                      checked={!allSelected && p.branches!.includes(b.name)}
                    />
                    <span className="truncate">{b.name}</span>
                  </DropdownItem>
                ))}
              </>
            )}
            {localBranches.length === 0 && <div className="px-3 py-1 text-fg-dim">No branches</div>}
          </div>
        )}
      </Dropdown>

      <label
        className="flex items-center gap-1 cursor-pointer select-none"
        title="Show remote branches"
      >
        <input
          type="checkbox"
          checked={p.settings.showRemoteBranches}
          onChange={(e) => p.updateSettings({ showRemoteBranches: e.target.checked })}
        />
        Show Remote Branches
      </label>

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
            title="Next match (Enter)"
            disabled={!p.search.count}
            onClick={p.search.next}
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
        disabled={!p.data || p.data.remotes.length === 0}
        onClick={p.onFetch}
      >
        <IconCloudDownload className="w-4 h-4" />
      </button>
      <SplitButton
        icon={<IconDownload className="w-4 h-4" />}
        title={upstream ? `Pull from ${upstream.name}` : 'Pull…'}
        optionsTitle="Pull with options (remote, branch, rebase)…"
        count={upstream?.behind}
        disabled={!p.data || p.data.remotes.length === 0}
        onClick={p.onPull}
        onOptions={p.onPullOptions}
      />
      <SplitButton
        icon={<IconUpload className="w-4 h-4" />}
        title={upstream && p.data?.currentBranch ? `Push to ${upstream.name}` : 'Push…'}
        optionsTitle="Push with options (remote, set upstream, force with lease)…"
        count={upstream?.ahead}
        disabled={!p.data || p.data.remotes.length === 0 || !p.data.currentBranch}
        onClick={p.onPush}
        onOptions={p.onPushOptions}
      />

      <Dropdown
        icon={<IconCloud className="w-4 h-4" />}
        label="Remotes"
        align="right"
        title="Manage remotes"
      >
        {(close) => (
          <div className="py-1 min-w-[320px]">
            {(p.data?.remotes ?? []).map((r) => (
              <div key={r.name} className="flex items-center px-3 py-1 gap-2">
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs opacity-60 truncate mono">{r.url}</span>
                </span>
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
            ))}
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

/** An icon button that acts immediately, with a narrow chevron that opens the options dialog. */
function SplitButton(p: {
  icon: ReactNode
  title: string
  optionsTitle: string
  count?: number
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
        disabled={p.disabled}
        onClick={p.onClick}
      >
        {p.icon}
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
        disabled={p.disabled}
        onClick={p.onOptions}
      >
        <IconChevronDown className="w-3 h-3 opacity-70" />
      </button>
    </span>
  )
}
