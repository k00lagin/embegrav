import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepoInfo } from '@shared/types'
import { icnsPng, MAX_REPO_ICON_BYTES, REPO_ICON_EXTENSIONS } from '@shared/repo-icons'
import { api } from '@/api'
import { leafPart } from '@/lib/paths'
import {
  decodeIcon,
  RepoIcon,
  RepoIconFilePreview,
  useRepoIconChoice,
  type RepoIconChoice,
} from './RepoIcon'

const accept = REPO_ICON_EXTENSIONS.map((ext) => `.${ext}`).join(',')

async function uploadedIcon(file: File): Promise<string> {
  if (file.size > MAX_REPO_ICON_BYTES) throw new Error('The image must be 16 MB or smaller')
  let image: Blob = file
  if (file.name.toLowerCase().endsWith('.icns')) {
    const png = icnsPng(new Uint8Array(await file.arrayBuffer()))
    if (!png) throw new Error('This ICNS file has no PNG image')
    image = new Blob([new Uint8Array(png)], { type: 'image/png' })
  }
  const url = URL.createObjectURL(image)
  try {
    const img = await decodeIcon(url)
    const scale = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight, 1)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image previews are unavailable')
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function RepoIconSettings({ repo, onClose }: { repo: RepoInfo; onClose: () => void }) {
  const { choice, setChoice } = useRepoIconChoice(repo.path)
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ choice: RepoIconChoice; src: string } | null>(null)
  const matches = useMemo(() => {
    const needle = query.trim().replaceAll('\\', '/').toLowerCase()
    return files?.filter((file) => file.toLowerCase().includes(needle))
  }, [files, query])

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    input.current?.focus()
    return () => element?.close()
  }, [])

  useEffect(() => {
    let active = true
    void api.repoIconFiles(repo.path).then(
      (result) => {
        if (active) setFiles(result.files)
      },
      (err: Error) => {
        if (active) setFilesError(err.message)
      },
    )
    return () => {
      active = false
    }
  }, [repo.path])

  const showPreview = async (load: () => Promise<{ choice: RepoIconChoice; src: string }>) => {
    if (busy) return
    setBusy(true)
    setPreview(null)
    setError(null)
    try {
      setPreview(await load())
    } catch (err) {
      setError((err as Error).message || 'Could not open this image')
    } finally {
      setBusy(false)
    }
  }

  const choose = (file: string) =>
    showPreview(async () => {
      const { icon } = await api.repoIcon(repo.path, file)
      if (!icon) throw new Error('Could not read this repository image')
      await decodeIcon(icon.src)
      return { choice: { kind: 'project', file }, src: icon.src }
    })

  const save = (value: RepoIconChoice | null) => {
    setChoice?.(repo.path, value)
    onClose()
  }

  return (
    <dialog
      ref={dialog}
      className="modal fixed mx-auto mt-[10vh] w-[520px] max-w-[92vw] max-h-[80vh] p-0 backdrop:bg-black/40"
      aria-labelledby="repo-icon-settings-title"
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="p-4 space-y-3">
        <h2 id="repo-icon-settings-title" className="font-semibold">
          Repository settings
        </h2>
        <div className="flex items-center gap-2">
          <RepoIcon repo={repo} eager />
          <div className="min-w-0">
            <div className="font-semibold truncate">{repo.name}</div>
            <div className="text-xs text-fg-muted mono truncate" title={repo.path}>
              {repo.path}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="truncate" title={choice?.file}>
            Icon <span className="text-fg-muted">{choice?.file ?? 'Automatic'}</span>
          </span>
          <button
            type="button"
            className="btn shrink-0"
            disabled={!choice || busy}
            onClick={() => save(null)}
          >
            Use automatic
          </button>
        </div>
        <input
          ref={input}
          type="search"
          className="w-full"
          placeholder="Search image files…"
          aria-label="Search image files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches?.[0]) void choose(matches[0])
          }}
        />
        <div
          className="h-40 overflow-y-auto border border-border rounded"
          aria-label="Repository image files"
        >
          {matches?.slice(0, 150).map((file) => (
            <button
              key={file}
              type="button"
              className={`dropdown-item flex w-full items-center gap-2 px-2 py-1 text-left ${preview?.choice.kind === 'project' && preview.choice.file === file ? 'active' : ''}`}
              onClick={() => void choose(file)}
              title={file}
            >
              <RepoIconFilePreview repoPath={repo.path} file={file} />
              <span className="min-w-0">
                <span className="block truncate">{leafPart(file)}</span>
                <span className="block text-xs opacity-60 truncate mono">{file}</span>
              </span>
            </button>
          ))}
          {(!matches?.length || matches.length > 150) && (
            <div role="status" className="px-2 py-1 text-fg-muted">
              {filesError ??
                (matches
                  ? matches.length
                    ? 'Refine the search to see more images'
                    : files?.length
                      ? 'No matching images'
                      : 'No image files found'
                  : 'Indexing project images…')}
            </div>
          )}
        </div>
        {busy && (
          <div role="status" className="text-fg-muted">
            Loading image…
          </div>
        )}
        {error && (
          <div role="alert" className="text-danger">
            {error}
          </div>
        )}
        {preview && (
          <div className="flex items-center gap-2 text-fg-muted">
            <img src={preview.src} alt="Icon preview" className="size-5 shrink-0 object-contain" />
            <span className="truncate" title={preview.choice.file}>
              {preview.choice.file}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={upload}
            type="file"
            accept={accept}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file)
                void showPreview(async () => {
                  const src = await uploadedIcon(file)
                  return { choice: { kind: 'upload', file: file.name, src }, src }
                })
            }}
          />
          <button
            type="button"
            className="btn mr-auto"
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            Browse…
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn"
            disabled={!preview || busy}
            onClick={() => preview && save(preview.choice)}
          >
            Save icon
          </button>
        </div>
      </div>
    </dialog>
  )
}
