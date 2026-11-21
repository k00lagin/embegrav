import type { KeyboardEvent, Ref } from 'react'
import IconSearch from '~icons/lucide/search'
import IconX from '~icons/lucide/x'

/** The search field heading a dropdown list; it stays in view while the list scrolls. */
export function FilterInput({
  ref,
  ...p
}: {
  ref: Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  /** Shows the text as an error, such as when nothing matches */
  invalid?: boolean
  disabled?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="filter-input">
      <IconSearch className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <input
        ref={ref}
        type="text"
        placeholder={p.placeholder}
        aria-label={p.label}
        aria-invalid={p.invalid || undefined}
        spellCheck={false}
        value={p.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.value)}
        onKeyDown={p.onKeyDown}
      />
      {p.value && (
        <button
          type="button"
          className="icon-btn size-5! shrink-0 text-fg-muted! hover:text-fg!"
          title="Clear"
          aria-label="Clear search"
          disabled={p.disabled}
          onClick={(e) => {
            p.onChange('')
            e.currentTarget.parentElement?.querySelector('input')?.focus()
          }}
        >
          <IconX className="size-3.5" />
        </button>
      )}
    </div>
  )
}
