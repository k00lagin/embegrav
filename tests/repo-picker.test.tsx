// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { DirectoryListing } from '@shared/types'
import { api } from '@/api'
import { RepoPicker } from '@/components/RepoPicker'
import { childPath, directoryPart, leafPart, parentPath } from '@/lib/paths'
import { browse } from '../server/browse.ts'

describe('path helpers', () => {
  it('splits and joins Windows paths', () => {
    expect(directoryPart('C:\\Git\\rep')).toBe('C:\\Git\\')
    expect(leafPart('C:\\Git\\rep')).toBe('rep')
    expect(childPath('C:\\Git\\rep', 'repotree')).toBe('C:\\Git\\repotree\\')
    expect(childPath('C:/Git/', 'x')).toBe('C:/Git/x\\')
    expect(parentPath('C:\\Git\\repotree\\')).toBe('C:\\Git\\')
    expect(parentPath('C:\\Git\\')).toBe('C:\\')
    expect(parentPath('C:\\')).toBeNull()
  })

  it('splits and joins POSIX paths', () => {
    expect(directoryPart('/home/me/re')).toBe('/home/me/')
    expect(childPath('/home/me/', 'repo')).toBe('/home/me/repo/')
    expect(parentPath('/home/me/repo/')).toBe('/home/me/')
    expect(parentPath('/home/')).toBe('/')
    expect(parentPath('/')).toBeNull()
  })
})

describe('server browse', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'embegrav-browse-'))
    await mkdir(join(root, 'alpha', '.git'), { recursive: true })
    await mkdir(join(root, 'Another'))
    await mkdir(join(root, 'beta'))
    await mkdir(join(root, '.hidden'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists sub-directories and marks repositories', async () => {
    const r = await browse(root + sep)
    expect(r.directory).toBe(root + sep)
    expect(r.entries).toEqual([
      { name: 'alpha', path: join(root, 'alpha'), isRepo: true },
      { name: 'Another', path: join(root, 'Another'), isRepo: false },
      { name: 'beta', path: join(root, 'beta'), isRepo: false },
    ])
  })

  it('filters by a case-insensitive prefix and shows dot-folders on request', async () => {
    expect((await browse(join(root, 'a'))).entries.map((e) => e.name)).toEqual(['alpha', 'Another'])
    expect((await browse(join(root, '.h'))).entries.map((e) => e.name)).toEqual(['.hidden'])
  })

  it('reports a missing directory', async () => {
    await expect(browse(join(root, 'missing') + sep)).rejects.toThrow('Directory not found')
  })
})

describe('RepoPicker', () => {
  const listings: Record<string, DirectoryListing> = {
    '/src/': {
      directory: '/src/',
      entries: [
        { name: 'app', path: '/src/app', isRepo: true },
        { name: 'docs', path: '/src/docs', isRepo: false },
      ],
    },
    '/src/docs/': { directory: '/src/docs/', entries: [] },
  }
  beforeEach(() => {
    vi.spyOn(api, 'browse').mockImplementation(async (path) => {
      const listing = listings[path]
      if (!listing) throw new Error(`Directory not found: ${path}`)
      return listing
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('navigates with the keyboard and adds the typed path', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<RepoPicker initialPath="/src/" onSubmit={onSubmit} onClose={() => {}} />)
    const input = screen.getByLabelText('Repository path')
    await screen.findByText('docs')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveProperty('value', '/src/docs/')
    await screen.findByText('No folders')

    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(input).toHaveProperty('value', '/src/')

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('/src/'))
  })

  it('adds a repository entry directly and keeps errors inside the picker', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('No git repository found at /src/app')
    })
    render(<RepoPicker initialPath="/src/" onSubmit={onSubmit} onClose={() => {}} />)
    await screen.findByText('app')
    const row = screen.getByRole('option', { name: /app/ })
    fireEvent.click(within(row).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('/src/app'))
    await screen.findByText('No git repository found at /src/app')
  })

  it('starts in the home directory when there is no current repository', async () => {
    vi.spyOn(api, 'browseHome').mockResolvedValue({ path: '/src/' })
    render(<RepoPicker initialPath={null} onSubmit={async () => {}} onClose={() => {}} />)
    expect(await screen.findByLabelText('Repository path')).toHaveProperty('value', '/src/')
    await screen.findByText('app')
  })
})
