import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { themeToTreeStyles } from '@pierre/trees'
import type { GitStatusEntry, ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees'
import type { ChangedFile } from '@shared/types'
import { useTheme } from '@/theme/ThemeProvider'
import type { MenuEntry } from './ContextMenu'

/** A button shown on the hovered row (like VS Code's inline stage / unstage / discard). */
export interface RowAction {
  label: string
  icon: ReactNode
  onClick: () => void
  /** Also triggered by Space on the keyboard-focused row */
  primary?: boolean
}

interface Props {
  files: ChangedFile[]
  onOpenFile: (file: ChangedFile) => void
  /** Optional context menu entries for a file (or directory: file is undefined) */
  menuFor?: (file: ChangedFile | undefined, path: string, isDirectory: boolean) => MenuEntry[]
  /** Optional inline actions for a file (or directory: file is undefined) */
  rowActions?: (file: ChangedFile | undefined, path: string, isDirectory: boolean) => RowAction[]
  emptyText?: string
  maxRows?: number
  selectedPath?: string
  fillHeight?: boolean
}

const ROW_HEIGHT = 22

function toGitStatus(status: ChangedFile['status']): GitStatusEntry['status'] {
  switch (status) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    case '?':
      return 'untracked'
    default:
      return 'modified'
  }
}

/** Changed files rendered with Pierre's file tree. */
export function ChangedFilesTree({
  files,
  onOpenFile,
  menuFor,
  rowActions,
  emptyText = 'No changes',
  maxRows = 16,
  selectedPath,
  fillHeight = false,
}: Props) {
  const syncingSelection = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoveredRow | null>(null)
  const paths = useMemo(() => files.map((f) => f.path), [files])
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => files.map((f) => ({ path: f.path, status: toGitStatus(f.status) })),
    [files],
  )
  const { resolved } = useTheme()
  const treeStyles = useMemo(() => {
    try {
      return themeToTreeStyles(resolved as Parameters<typeof themeToTreeStyles>[0])
    } catch {
      return {}
    }
  }, [resolved])
  // Pierre retains its initial callbacks for the model's entire lifetime.
  const filesRef = useRef(byPath)
  const colorsRef = useRef(resolved.colors)
  const menuRef = useRef(menuFor)
  const openRef = useRef(onOpenFile)
  useEffect(() => {
    filesRef.current = byPath
    colorsRef.current = resolved.colors
    menuRef.current = menuFor
    openRef.current = onOpenFile
  }, [byPath, resolved.colors, menuFor, onOpenFile])

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    itemHeight: ROW_HEIGHT,
    density: 'compact',
    composition: menuFor
      ? { contextMenu: { enabled: true, triggerMode: 'right-click' } }
      : undefined,
    renderRowDecoration: ({ item }) => {
      const f = filesRef.current.get(item.path)
      if (!f || item.kind !== 'file') return null
      if (f.additions === null && f.deletions === null) return null
      return {
        text: `+${f.additions ?? 0} −${f.deletions ?? 0}`,
        parts: [
          {
            text: `+${f.additions ?? 0}`,
            color: colorsRef.current?.['gitDecoration.addedResourceForeground'],
          },
          { text: ' ' },
          {
            text: `−${f.deletions ?? 0}`,
            color: colorsRef.current?.['gitDecoration.deletedResourceForeground'],
          },
        ],
      }
    },
    onSelectionChange: (selected) => {
      if (syncingSelection.current) return
      const path = selected[0]
      if (!path) return
      const f = filesRef.current.get(path)
      if (f) openRef.current(f)
    },
  })

  useEffect(() => {
    model.resetPaths(paths)
    model.setGitStatus(gitStatus)
  }, [model, paths, gitStatus])

  useEffect(() => {
    if (!selectedPath || !paths.includes(selectedPath)) return
    syncingSelection.current = true
    try {
      for (const path of model.getSelectedPaths()) {
        if (path !== selectedPath) model.getItem(path)?.deselect()
      }
      model.getItem(selectedPath)?.select()
      model.scrollToPath(selectedPath)
    } finally {
      syncingSelection.current = false
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- reapply selection if the tree model is replaced
  }, [model, selectedPath, paths])

  useEffect(() => {
    // Status can be unchanged when counts or theme colors change. Force the
    // mounted view to read the current decoration metadata in that case too.
    filesRef.current = byPath
    colorsRef.current = resolved.colors
    const container = model.getFileTreeContainer()
    if (container) model.render({ fileTreeContainer: container })
  }, [model, byPath, resolved.colors])

  // Visible rows: directories + files (approximation for the initial height)
  const dirCount = useMemo(() => {
    const dirs = new Set<string>()
    for (const p of paths) {
      const parts = p.split('/')
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    }
    return dirs.size
  }, [paths])
  const rows = Math.max(1, Math.min(maxRows, paths.length + dirCount))

  if (files.length === 0) {
    return <div className="text-fg-dim px-2 py-1">{emptyText}</div>
  }

  const actionsFor = (path: string, isDir: boolean) =>
    rowActions?.(isDir ? undefined : byPath.get(path), path, isDir) ?? []
  const hovered = hover && (isDir(hover) || byPath.has(hover.path)) ? hover : null

  // Rows live in Pierre's shadow DOM, so the actions are an overlay positioned
  // over the hovered row rather than part of the row itself.
  const trackHover = (e: React.MouseEvent) => {
    if (!rowActions || !wrapRef.current) return
    if ((e.target as HTMLElement).closest?.('.tree-row-actions')) return
    const row = e.nativeEvent
      .composedPath()
      .find(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && el.dataset.type === 'item' && !!el.dataset.itemPath,
      )
    if (!row) {
      setHover(null)
      return
    }
    const box = wrapRef.current.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    const next: HoveredRow = {
      path: row.dataset.itemPath!,
      kind: row.dataset.itemType === 'folder' ? 'directory' : 'file',
      top: r.top - box.top,
      height: r.height,
      selected: row.hasAttribute('data-item-selected'),
    }
    setHover((h) =>
      h &&
      h.path === next.path &&
      h.top === next.top &&
      h.height === next.height &&
      h.selected === next.selected
        ? h
        : next,
    )
  }

  return (
    <div
      ref={wrapRef}
      className={`relative${fillHeight ? ' h-full' : ''}`}
      onMouseMove={trackHover}
      onMouseLeave={() => setHover(null)}
      onWheel={() => setHover(null)}
      onKeyDown={(e) => {
        if (!rowActions || e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
        const path = model.getFocusedPath()
        if (!path) return
        const action = actionsFor(path, !!model.getItem(path)?.isDirectory()).find((a) => a.primary)
        if (!action) return
        e.preventDefault()
        action.onClick()
      }}
    >
      <FileTree
        model={model}
        className="changed-files-tree"
        style={{ ...treeStyles, height: fillHeight ? '100%' : rows * ROW_HEIGHT + 8 }}
        renderContextMenu={
          menuFor
            ? (item: ContextMenuItem, ctx: ContextMenuOpenContext) => (
                <TreeMenu
                  entries={
                    menuRef.current?.(
                      filesRef.current.get(item.path),
                      item.path,
                      item.kind === 'directory',
                    ) ?? []
                  }
                  close={ctx.close}
                />
              )
            : undefined
        }
      />
      {hovered && (
        <div
          className={`tree-row-actions${hovered.selected ? ' selected' : ''}`}
          style={{ top: hovered.top, height: hovered.height }}
        >
          {actionsFor(hovered.path, isDir(hovered)).map((a) => (
            <button
              key={a.label}
              type="button"
              className="icon-btn !w-5 !h-5"
              title={a.primary ? `${a.label} (Space)` : a.label}
              aria-label={`${a.label} ${hovered.path}`}
              onClick={(e) => {
                e.stopPropagation()
                a.onClick()
              }}
            >
              {a.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface HoveredRow {
  path: string
  kind: 'file' | 'directory'
  /** Position relative to the tree wrapper */
  top: number
  height: number
  selected: boolean
}

const isDir = (row: HoveredRow) => row.kind === 'directory'

function TreeMenu({
  entries,
  close,
}: {
  entries: MenuEntry[]
  close: (o?: { restoreFocus?: boolean }) => void
}) {
  if (entries.length === 0) return null
  return (
    <div className="context-menu !static" data-file-tree-context-menu-root="true">
      {entries.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="context-menu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              close()
              item.onClick()
            }}
          >
            <span className="w-4 shrink-0 inline-flex justify-center opacity-80">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
          </button>
        ),
      )}
    </div>
  )
}
