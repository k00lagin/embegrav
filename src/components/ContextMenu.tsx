import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { MenuItems, handleMenuKeyDown, type MenuEntry } from './MenuItems'

export type { MenuItem, MenuEntry } from './MenuItems'

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
  const previousFocus = useRef<HTMLElement | null>(null)
  const focused = useRef(false)
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

  const restoreFocus = useCallback(() => {
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
  }, [])
  const close = () => {
    restoreFocus()
    onClose()
  }

  useLayoutEffect(() => {
    if (!menu) return
    const container = ref.current
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    focused.current = false
    return () => {
      // An action may already have moved focus to a dialog or another row.
      if (document.activeElement === document.body || container?.contains(document.activeElement)) {
        restoreFocus()
      }
    }
  }, [menu, restoreFocus])

  useEffect(() => {
    if (!menu || !pos || focused.current) return
    focused.current = true
    const target =
      input.current ?? ref.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? ref.current
    target?.focus()
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
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onBlur = (e: FocusEvent) => {
      // Moving focus into the search field must not dismiss the menu.
      if (!e.relatedTarget) onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onClose)
    }
  }, [menu, onClose])

  if (!menu) return null
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`context-menu${menu.searchPlaceholder ? ' context-menu-searchable' : ''}`}
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => handleMenuKeyDown(e, close, input.current)}
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
          />
        </div>
      )}
      <MenuItems
        items={items}
        onClose={close}
        label={menu.searchPlaceholder}
        className={menu.searchPlaceholder ? 'min-h-0 overflow-y-auto' : undefined}
        emptyText={menu.searchPlaceholder ? 'No results' : undefined}
      />
    </div>
  )
}
