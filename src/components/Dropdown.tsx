import { useEffect, useRef, useState, type ReactNode } from 'react'
import IconChevronDown from '~icons/lucide/chevron-down'

interface Props {
  label: ReactNode
  icon?: ReactNode
  title?: string
  className?: string
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
}

/** A toolbar button that opens a floating panel below it. */
export function Dropdown({ label, icon, title, className = '', align = 'left', children }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        title={title}
        className={`dropdown-trigger flex items-center gap-1 h-[26px] px-2 rounded border border-transparent ${
          open ? 'border-focus' : ''
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="max-w-[240px] truncate">{label}</span>
        <IconChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>
      {open && (
        <div className="dropdown-panel mt-1" style={align === 'right' ? { right: 0 } : { left: 0 }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function DropdownItem({
  children,
  onClick,
  active,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`dropdown-item w-full text-left px-3 py-1.5 flex items-center gap-2 ${
        active ? 'active' : ''
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
