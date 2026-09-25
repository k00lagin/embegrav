import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}

export type MenuEntry = MenuItem | 'separator'

export interface ContextMenuState {
  x: number
  y: number
  placement?: 'above'
  searchPlaceholder?: string
  items: MenuEntry[]
}

interface Props {
  menu: ContextMenuState | null
  onClose: () => void
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [search, setSearch] = useState<{ menu: ContextMenuState; query: string } | null>(null)
  const query = search?.menu === menu ? (search?.query ?? '') : ''
  const needle = query.trim().toLowerCase()
  const items =
    menu?.items.filter(
      (item) =>
        !needle ||
        (item !== 'separator' && `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(needle)),
    ) ?? []

  useEffect(() => {
    if (menu?.searchPlaceholder && pos) input.current?.focus()
  }, [menu, pos])

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null)
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const left = Math.min(menu.x, window.innerWidth - rect.width - 8)
    const top = Math.min(
      menu.y - (menu.placement === 'above' ? rect.height : 0),
      window.innerHeight - rect.height - 8,
    )
    setPos({ left: Math.max(4, left), top: Math.max(4, top) })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- filtering changes menu height and its bottom anchor
  }, [menu, query])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onBlur = (e: FocusEvent) => {
      // Moving focus into the search field must not dismiss the menu.
      if (!e.relatedTarget) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onClose)
    }
  }, [menu, onClose])

  if (!menu) return null
  return (
    <div
      ref={ref}
      className={`context-menu${menu.searchPlaceholder ? ' context-menu-searchable' : ''}`}
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.searchPlaceholder && (
        <div className="shrink-0 px-2 pt-1 pb-2 border-b border-border">
          <input
            ref={input}
            type="text"
            className="w-full"
            placeholder={menu.searchPlaceholder}
            aria-label={menu.searchPlaceholder}
            value={query}
            onChange={(e) => setSearch({ menu, query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const first = items.find(
                (item): item is MenuItem => item !== 'separator' && !item.disabled,
              )
              if (first) {
                onClose()
                first.onClick()
              }
            }}
          />
        </div>
      )}
      <div className={menu.searchPlaceholder ? 'min-h-0 overflow-y-auto' : undefined}>
        {items.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="context-menu-sep" />
          ) : (
            <button
              key={i}
              type="button"
              className={`context-menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onClick()
              }}
            >
              <span className="w-4 shrink-0 inline-flex justify-center opacity-80">
                {item.icon}
              </span>
              <span className="flex-1 min-w-0 break-words">{item.label}</span>
              {item.hint && <span className="text-fg-dim text-xs">{item.hint}</span>}
            </button>
          ),
        )}
        {menu.searchPlaceholder && items.length === 0 && (
          <div className="px-3 py-1 text-fg-dim">No results</div>
        )}
      </div>
    </div>
  )
}
