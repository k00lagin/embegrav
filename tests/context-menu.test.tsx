// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextMenu, type ContextMenuState, type MenuEntry } from '@/components/ContextMenu'

afterEach(cleanup)

function setup(searchPlaceholder?: string, entries?: MenuEntry[]) {
  const action = vi.fn()
  const disabledAction = vi.fn()
  const items: MenuEntry[] = entries ?? [
    { label: 'First', onClick: action },
    'separator',
    { label: 'Unavailable', disabled: true, onClick: disabledAction },
    { label: 'Last', onClick: action },
  ]
  function Harness() {
    const [menu, setMenu] = useState<ContextMenuState | null>(null)
    const [count, setCount] = useState(0)
    return (
      <>
        <button onClick={() => setMenu({ x: 10, y: 10, items, searchPlaceholder })}>Open</button>
        <button onClick={() => setCount(count + 1)}>Outside {count}</button>
        <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      </>
    )
  }
  const result = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
  const trigger = screen.getByRole('button', { name: 'Open' })
  trigger.focus()
  fireEvent.click(trigger)
  return { ...result, action, disabledAction, trigger }
}

function press(key: string, shiftKey = false) {
  fireEvent.keyDown(document.activeElement!, { key, shiftKey })
}

it('focuses the first item, wraps with arrows and supports Home/End without focusing separators', () => {
  setup()
  const [first, disabled, last] = screen.getAllByRole('menuitem')
  expect(document.activeElement).toBe(first)
  expect(first.tabIndex).toBe(-1)
  press('ArrowUp')
  expect(document.activeElement).toBe(last)
  press('ArrowDown')
  expect(document.activeElement).toBe(first)
  press('ArrowDown')
  expect(document.activeElement).toBe(disabled)
  press('End')
  expect(document.activeElement).toBe(last)
  press('Home')
  expect(document.activeElement).toBe(first)
})

it.each(['Enter', ' '])(
  'activates the focused item exactly once with %j and restores focus',
  (key) => {
    const { action, trigger } = setup()
    press('End')
    press(key)
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  },
)

it('keeps disabled items discoverable but never activates them by keyboard or mouse', () => {
  const { action, disabledAction } = setup()
  press('ArrowDown')
  expect(document.activeElement?.getAttribute('aria-disabled')).toBe('true')
  press('Enter')
  press(' ')
  fireEvent.click(document.activeElement!)
  expect(disabledAction).not.toHaveBeenCalled()
  expect(action).not.toHaveBeenCalled()
  expect(screen.getByRole('menu')).toBeTruthy()
})

it('closes with Escape without bubbling to surrounding shortcuts', () => {
  const { trigger } = setup()
  const shortcut = vi.fn()
  window.addEventListener('keydown', shortcut)
  try {
    press('Escape')
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(shortcut).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', shortcut)
  }
})

it.each([false, true])(
  'closes on Tab (shift=%s) and leaves default traversal enabled',
  (shiftKey) => {
    const { trigger } = setup()
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey })).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  },
)

it('navigates filtered results from search and returns to editing without losing the query', () => {
  const { action } = setup('Search actions')
  const input = screen.getByRole('textbox')
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'Last' } })
  expect(document.activeElement).toBe(input)
  press('ArrowDown')
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Last' }))
  press('ArrowUp')
  expect(document.activeElement).toBe(input)
  expect(input).toHaveProperty('value', 'Last')
  press('ArrowUp')
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Last' }))
  press('Enter')
  expect(action).toHaveBeenCalledTimes(1)
})

it('preserves text-editing keys and selects the first enabled search result with Enter', () => {
  const action = vi.fn()
  setup('Search actions', [
    { label: 'Disabled', disabled: true, onClick: vi.fn() },
    { label: 'Enabled', onClick: action },
  ])
  const input = screen.getByRole('textbox')
  for (const key of ['Home', 'End', ' ']) {
    expect(fireEvent.keyDown(input, { key })).toBe(true)
    expect(document.activeElement).toBe(input)
  }
  press('Enter')
  expect(action).toHaveBeenCalledTimes(1)
})

it('handles empty search results and resets search on reopening', () => {
  const { action, trigger } = setup('Search actions')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } })
  press('ArrowDown')
  press('ArrowUp')
  press('Enter')
  expect(document.activeElement).toBe(screen.getByRole('textbox'))
  expect(action).not.toHaveBeenCalled()
  press('Escape')
  fireEvent.click(trigger)
  expect(screen.getByRole('textbox')).toHaveProperty('value', '')
  expect(document.activeElement).toBe(screen.getByRole('textbox'))
})

it('restores focus on external dismissal and does not steal focus chosen by an action', () => {
  const { trigger } = setup(undefined, [
    {
      label: 'Move focus',
      onClick: () => screen.getByRole('button', { name: 'Outside 0' }).focus(),
    },
  ])
  fireEvent.resize(window)
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  press('Enter')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside 0' }))
})

it('does not reset item focus when the parent rerenders with a new onClose callback', () => {
  setup()
  press('End')
  fireEvent.click(screen.getByRole('button', { name: 'Outside 0' }))
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Last' }))
})

it('can dismiss an empty menu and restore focus when unmounted', () => {
  const { unmount, trigger } = setup(undefined, [])
  expect(document.activeElement?.contains(screen.getByRole('menu'))).toBe(true)
  press('ArrowDown')
  press('Enter')
  press('Escape')
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  unmount()
  expect(document.activeElement).toBe(document.body)
})

it('restores the original focus when an open menu is unmounted', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  try {
    const { unmount } = render(
      <StrictMode>
        <ContextMenu
          menu={{ x: 0, y: 0, items: [{ label: 'Action', onClick: vi.fn() }] }}
          onClose={vi.fn()}
        />
      </StrictMode>,
    )
    expect(document.activeElement).toBe(screen.getByRole('menuitem'))
    unmount()
    expect(document.activeElement).toBe(trigger)
  } finally {
    trigger.remove()
  }
})

it('dismisses on outside mousedown and allows the clicked control to receive focus', () => {
  setup()
  const outside = screen.getByRole('button', { name: 'Outside 0' })
  fireEvent.mouseDown(outside)
  outside.focus()
  fireEvent.click(outside)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(outside)
})
