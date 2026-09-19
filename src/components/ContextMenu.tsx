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
  items: MenuEntry[]
}

interface Props {
  menu: ContextMenuState | null
  onClose: () => void
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null)
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const left = Math.min(menu.x, window.innerWidth - rect.width - 8)
    const top = Math.min(menu.y, window.innerHeight - rect.height - 8)
    setPos({ left: Math.max(4, left), top: Math.max(4, top) })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [menu, onClose])

  if (!menu) return null
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
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
            <span className="w-4 shrink-0 inline-flex justify-center opacity-80">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-fg-dim text-xs">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  )
}
