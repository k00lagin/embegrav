import { useEffect, useMemo, useRef } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { themeToTreeStyles } from '@pierre/trees'
import type { GitStatusEntry, ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees'
import type { ChangedFile } from '@shared/types'
import { useTheme } from '@/theme/ThemeProvider'
import type { MenuEntry } from './ContextMenu'

interface Props {
  files: ChangedFile[]
  onOpenFile: (file: ChangedFile) => void
  /** Optional context menu entries for a file (or directory: file is undefined) */
  menuFor?: (file: ChangedFile | undefined, path: string, isDirectory: boolean) => MenuEntry[]
  emptyText?: string
  maxRows?: number
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
  emptyText = 'No changes',
  maxRows = 16,
}: Props) {
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

  return (
    <FileTree
      model={model}
      className="changed-files-tree"
      style={{ ...treeStyles, height: rows * ROW_HEIGHT + 8 }}
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
  )
}

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
