import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DirectoryListing } from '@shared/types'
import { api } from '@/api'
import { childPath, directoryPart, parentPath } from '@/lib/paths'
import IconX from '~icons/lucide/x'
import IconFolder from '~icons/lucide/folder'
import IconFolderGit from '~icons/lucide/folder-git-2'
import IconFolderUp from '~icons/lucide/folder-up'
import IconLoader from '~icons/lucide/loader-circle'

interface Props {
  /** Path to start browsing from; the home directory when null */
  initialPath: string | null
  /** Register the path; a rejection is shown in the picker, which stays open */
  onSubmit: (path: string) => Promise<void>
  onClose: () => void
}

export function RepoPicker({ initialPath, onSubmit, onClose }: Props) {
  const [input, setInput] = useState(initialPath ?? '')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  /** The input the current listing (or error) belongs to */
  const [loadedInput, setLoadedInput] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const entries = listing?.entries ?? []
  const parent = parentPath(directoryPart(input))
  const loading = input.trim() !== '' && loadedInput !== input

  useEffect(() => {
    if (initialPath !== null) return
    api
      .browseHome()
      .then((r) => setInput((current) => current || r.path))
      .catch((e: Error) => setError(e.message))
  }, [initialPath])

  useEffect(() => {
    if (!input.trim()) return
    let stale = false
    api
      .browse(input)
      .then((r) => {
        if (stale) return
        setListing(r)
        setHighlighted(0)
        setError(null)
        listRef.current?.scrollTo?.(0, 0)
      })
      .catch((e: Error) => {
        if (stale) return
        setListing(null)
        setError(e.message)
      })
      .finally(() => {
        if (!stale) setLoadedInput(input)
      })
    return () => {
      stale = true
    }
  }, [input])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    listRef.current?.children[highlighted]?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])

  const submit = async (path: string) => {
    if (!path.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(path.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((i) => Math.min(i + 1, entries.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[highlighted]
      if (e.ctrlKey || e.metaKey || !entry) void submit(input)
      else setInput(childPath(input, entry.name))
    } else if (e.key === 'Backspace' && input === directoryPart(input) && parent) {
      e.preventDefault()
      setInput(parent)
    }
  }

  return (
    <div className="modal-backdrop pt-[8vh]" onMouseDown={onClose}>
      <div
        className="modal w-[640px] max-w-[92vw] h-[70vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center">
          <span className="flex-1">Add Repository</span>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            <IconX className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
          <input
            autoFocus
            type="text"
            className="mono flex-1 min-w-0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            aria-label="Repository path"
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => parent && setInput(parent)}
            disabled={!parent}
            title="Parent folder (Backspace)"
          >
            <IconFolderUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void submit(input)}
            disabled={submitting || !input.trim()}
            title="Add this path (Ctrl+Enter)"
          >
            Add
          </button>
        </div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1" role="listbox">
          {entries.map((entry, i) => (
            <div
              key={entry.path}
              role="option"
              aria-selected={i === highlighted}
              className={`group flex items-center gap-2 px-4 py-[3px] cursor-pointer ${
                i === highlighted ? 'bg-selected text-selected-fg' : ''
              }`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => setInput(childPath(input, entry.name))}
            >
              {entry.isRepo ? (
                <IconFolderGit className="w-4 h-4 shrink-0 text-warning" />
              ) : (
                <IconFolder className="w-4 h-4 shrink-0 opacity-70" />
              )}
              <span className="flex-1 min-w-0 truncate">{entry.name}</span>
              {entry.isRepo && (
                <button
                  type="button"
                  className={`btn py-0 ${i === highlighted ? '' : 'invisible group-hover:visible'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void submit(entry.path)
                  }}
                  disabled={submitting}
                >
                  Add
                </button>
              )}
            </div>
          ))}
          {!loading && listing && entries.length === 0 && (
            <div className="px-4 py-1 text-fg-muted">No folders</div>
          )}
          {loading && !listing && (
            <div className="px-4 py-1 text-fg-muted flex items-center gap-2">
              <IconLoader className="animate-spin" /> Reading folder…
            </div>
          )}
        </div>
        <div
          className={`px-4 py-2 border-t border-border text-xs truncate ${
            error ? 'text-danger' : 'text-fg-muted'
          }`}
        >
          {error ??
            '↑↓ select · Enter open folder · Backspace parent folder · Ctrl+Enter add path · a folder of repositories adds all of them'}
        </div>
      </div>
    </div>
  )
}
