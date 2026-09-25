import type { KeyboardEvent, ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}

export type MenuEntry = MenuItem | 'separator'

export function handleMenuKeyDown(
  e: KeyboardEvent<HTMLDivElement>,
  close: () => void,
  searchInput: HTMLInputElement | null = null,
) {
  // Menu keys must not reach graph or dialog shortcuts.
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'Tab') {
    // Let the browser continue tabbing from the invoking element.
    close()
    return
  }
  const buttons = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  )
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const inSearch = e.target === searchInput
  if (e.key === 'Enter' || (e.key === ' ' && !inSearch)) {
    e.preventDefault()
    const target = inSearch
      ? buttons.find((button) => button.getAttribute('aria-disabled') !== 'true')
      : buttons[index]
    target?.click()
    return
  }
  if (inSearch && (e.key === 'Home' || e.key === 'End')) return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  if (inSearch) {
    ;(e.key === 'ArrowUp' ? buttons.at(-1) : buttons[0])?.focus()
  } else if (e.key === 'Home') buttons[0]?.focus()
  else if (e.key === 'End') buttons.at(-1)?.focus()
  else if (
    searchInput &&
    ((e.key === 'ArrowUp' && index === 0) ||
      (e.key === 'ArrowDown' && index === buttons.length - 1))
  ) {
    searchInput.focus()
  } else {
    const next =
      index < 0
        ? e.key === 'ArrowUp'
          ? buttons.length - 1
          : 0
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
}

export function MenuItems({
  items,
  onClose,
  label = 'Context menu',
  className,
  emptyText,
}: {
  items: MenuEntry[]
  onClose: () => void
  label?: string
  className?: string
  emptyText?: string
}) {
  return (
    <div role="menu" aria-label={label} className={className}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} role="separator" className="context-menu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
          >
            <span className="w-4 shrink-0 inline-flex justify-center opacity-80">{item.icon}</span>
            <span className="flex-1 min-w-0 break-words">{item.label}</span>
            {item.hint && <span className="text-fg-dim text-xs">{item.hint}</span>}
          </button>
        ),
      )}
      {emptyText && items.length === 0 && <div className="px-3 py-1 text-fg-dim">{emptyText}</div>}
    </div>
  )
}
