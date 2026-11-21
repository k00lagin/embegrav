import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GitRef, GraphData } from '@shared/types'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconChevronRight from '~icons/lucide/chevron-right'
import IconFolder from '~icons/lucide/folder'
import IconGitBranch from '~icons/lucide/git-branch'
import { Dropdown } from './Dropdown'
import { FilterInput } from './FilterInput'

interface Props {
  data: GraphData | null
  branches: string[] | null
  onBranchesChange: (branches: string[] | null) => void
  showRemote: boolean
  onShowRemoteChange: (show: boolean) => void
}

export function BranchFilter(p: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const refs = p.data?.refs
  const visibleBranches =
    p.showRemote || !refs
      ? p.branches
      : p.branches?.filter((name) => refs.some((r) => r.type === 'head' && r.name === name))
  const label = !visibleBranches?.length
    ? 'Branches: Show All'
    : visibleBranches.length === 1
      ? `Branch: ${visibleBranches[0]}`
      : `Branches: ${visibleBranches.length} selected`

  return (
    <Dropdown
      icon={<IconGitBranch className="w-4 h-4 shrink-0" />}
      label={label}
      title="Filter the graph to selected branches"
      panelClassName="w-[330px] max-w-[calc(100vw-16px)] !min-w-0 overflow-x-hidden"
    >
      {() => (
        <BranchFilterPanel
          {...p}
          allSelected={!visibleBranches?.length}
          collapsed={collapsed}
          onCollapseChange={(group, hide) =>
            setCollapsed((prev) => updateCollapse(prev, group, hide))
          }
        />
      )}
    </Dropdown>
  )
}

function updateCollapse(previous: ReadonlySet<string>, group: string, collapsed: boolean) {
  const next = new Set(previous)
  if (collapsed) next.add(group)
  else next.delete(group)
  return next
}

function BranchFilterPanel(
  p: Props & {
    allSelected: boolean
    collapsed: ReadonlySet<string>
    onCollapseChange: (group: string, collapsed: boolean) => void
  },
) {
  const [query, setQuery] = useState('')
  const [searchCollapsed, setSearchCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const input = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const collapsed = needle ? searchCollapsed : p.collapsed
  const refs = p.data?.refs ?? []
  const localBranches = refs.filter(
    (r) => r.type === 'head' && r.name.toLowerCase().includes(needle),
  )
  const remoteGroups = new Map<string, GitRef[]>()
  if (p.showRemote) {
    // A configured remote can itself contain slashes. Prefer the longest matching name.
    const remotes = (p.data?.remotes ?? []).toSorted((a, b) => b.name.length - a.name.length)
    for (const ref of refs) {
      if (ref.type !== 'remote' || !ref.name.toLowerCase().includes(needle)) continue
      const remote =
        remotes.find((r) => ref.name.startsWith(`${r.name}/`))?.name ??
        ref.remote ??
        ref.name.split('/')[0]
      const group = remoteGroups.get(remote)
      if (group) group.push(ref)
      else remoteGroups.set(remote, [ref])
    }
  }

  useEffect(() => {
    input.current?.focus()
  }, [])

  const toggleBranch = (name: string) => {
    const selected = p.branches ?? []
    const next = selected.includes(name) ? selected.filter((b) => b !== name) : [...selected, name]
    p.onBranchesChange(next.length ? next : null)
  }

  const groupState = (group: string) => ({
    collapsed: collapsed.has(group),
    onToggle: () => {
      const hide = !collapsed.has(group)
      p.onCollapseChange(group, hide)
      if (needle) setSearchCollapsed((prev) => updateCollapse(prev, group, hide))
    },
  })

  const branch = (ref: GitRef, label = ref.name) => (
    <BranchCheckbox
      key={ref.name}
      name={ref.name}
      label={label}
      checked={p.branches?.includes(ref.name) ?? false}
      bold={ref.type === 'head' && ref.name === p.data?.currentBranch}
      onChange={() => toggleBranch(ref.name)}
    />
  )

  const remoteCount = [...remoteGroups.values()].reduce((n, group) => n + group.length, 0)
  const nothingFound = localBranches.length === 0 && remoteGroups.size === 0

  return (
    <div>
      <FilterInput
        ref={input}
        placeholder="Search branches"
        label="Search branches"
        value={query}
        invalid={!!needle && nothingFound}
        onChange={(value) => {
          setQuery(value)
          setSearchCollapsed(new Set())
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const first = localBranches[0] ?? remoteGroups.values().next().value?.[0]
          if (first) toggleBranch(first.name)
        }}
      />
      <div className="p-1">
        {!needle && (
          <>
            <BranchCheckbox
              name="All branches"
              label="All branches"
              checked={p.allSelected}
              onChange={() => {
                if (!p.allSelected) p.onBranchesChange(null)
              }}
            />
            <div className="context-menu-sep mx-2!" role="separator" />
          </>
        )}
        {(!needle || localBranches.length > 0) && (
          <BranchGroup label="Local" count={localBranches.length} {...groupState('local')}>
            {localBranches.map((ref) => branch(ref))}
          </BranchGroup>
        )}
        <BranchGroup
          label="Remote"
          count={p.showRemote ? remoteCount : undefined}
          {...groupState('remote')}
          action={
            <button
              type="button"
              role="switch"
              aria-label="Show remote branches"
              aria-checked={p.showRemote}
              title="Show remote branches"
              className={`mr-1.5 flex h-4 w-7 shrink-0 items-center rounded-full px-[3px] transition-colors ${
                p.showRemote ? 'justify-end bg-accent' : 'bg-bg-4'
              }`}
              onClick={() => p.onShowRemoteChange(!p.showRemote)}
            >
              <span
                className={`size-2.5 rounded-full ${p.showRemote ? 'bg-accent-fg' : 'bg-fg-muted'}`}
              />
            </button>
          }
        >
          {[...remoteGroups].map(([remote, branches]) => (
            <BranchGroup
              key={remote}
              label={remote}
              count={branches.length}
              folder
              {...groupState(`remote:${remote}`)}
            >
              {branches.map((ref) =>
                branch(
                  ref,
                  ref.name.startsWith(`${remote}/`) ? ref.name.slice(remote.length + 1) : ref.name,
                ),
              )}
            </BranchGroup>
          ))}
        </BranchGroup>
        {nothingFound && (
          <div className="px-2 py-2 text-fg-muted">
            {needle ? 'No matching branches' : 'No branches'}
          </div>
        )}
      </div>
    </div>
  )
}

function BranchGroup({
  label,
  count,
  folder,
  collapsed,
  onToggle,
  action,
  children,
}: {
  label: string
  /** Number of branches in the group, shown muted after the label */
  count?: number
  folder?: boolean
  collapsed: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode[]
}) {
  const hasChildren = children.length > 0
  const expanded = hasChildren && !collapsed
  const Chevron = expanded ? IconChevronDown : IconChevronRight
  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[5px] px-1.5 text-left ${hasChildren ? 'dropdown-item' : ''}`}
          aria-expanded={hasChildren ? expanded : undefined}
          disabled={!hasChildren}
          onClick={onToggle}
        >
          <Chevron className={`size-3 shrink-0 text-fg-muted ${hasChildren ? '' : 'invisible'}`} />
          {folder && <IconFolder className="size-3.5 shrink-0 text-fg-muted" />}
          <span className={folder ? 'truncate' : 'truncate font-semibold'}>{label}</span>
          {!!count && (
            <span className="ml-auto pl-2 text-xs tabular-nums text-fg-muted" aria-hidden>
              {count}
            </span>
          )}
        </button>
        {action}
      </div>
      {expanded && (
        // The guide line runs under the group's chevron.
        <div
          role="group"
          aria-label={label}
          className="ml-[11px] border-l border-[color-mix(in_srgb,var(--vscode-foreground)_14%,transparent)] pl-1.5"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function BranchCheckbox(p: {
  name: string
  label: string
  checked: boolean
  bold?: boolean
  onChange: () => void
}) {
  return (
    <label
      className="dropdown-item flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-1.5"
      title={p.name}
    >
      <input
        type="checkbox"
        aria-label={p.name}
        className="size-3.5! shrink-0 rounded-[3px]! checked:border-accent! checked:bg-accent! checked:text-accent-fg!"
        checked={p.checked}
        onChange={p.onChange}
      />
      <span className={p.bold ? 'truncate font-bold' : 'truncate'}>{p.label}</span>
    </label>
  )
}
