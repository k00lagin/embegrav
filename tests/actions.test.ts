import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../server/git.ts'
import { runAction } from '../server/actions.ts'
import { decodeActionRequest } from '../shared/actions.ts'

describe('Git action outcomes', () => {
  let repo: string
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'embegrav-actions-'))
    await git(repo, ['init', '-b', 'main'])
    await git(repo, ['config', 'user.name', 'Test'])
    await git(repo, ['config', 'user.email', 'test@example.com'])
    await git(repo, ['config', 'core.autocrlf', 'false'])
  })
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  const write = (path: string, contents: string) => writeFile(join(repo, path), contents)
  const read = (path: string) => readFile(join(repo, path), 'utf8')
  async function commit(message: string) {
    await git(repo, ['add', '-A'])
    await git(repo, ['commit', '-m', message])
  }

  describe('discard outcomes', () => {
    it('restores exact unstaged/staged paths and preserves untargeted changes', async () => {
      for (const path of ['alpha.txt', 'lpha.txt', '[ab].txt', 'a.txt', ' leading space.txt'])
        await write(path, 'original\n')
      await commit('base')
      for (const path of ['alpha.txt', 'lpha.txt', '[ab].txt', 'a.txt', ' leading space.txt'])
        await write(path, 'changed\n')
      await git(repo, ['add', '--', ' leading space.txt'])
      await runAction(repo, 'discard', { paths: ['alpha.txt', '[ab].txt', ' leading space.txt'] })
      expect(await read('alpha.txt')).toBe('original\n')
      expect(await read('[ab].txt')).toBe('original\n')
      expect(await read(' leading space.txt')).toBe('original\n')
      expect(await git(repo, ['show', ': leading space.txt'])).toBe('original\n')
      expect(await read('lpha.txt')).toBe('changed\n')
      expect(await read('a.txt')).toBe('changed\n')
    })

    it('discards additions, untracked files, a rename, and nested folder changes', async () => {
      await mkdir(join(repo, 'folder'))
      await write('old.txt', 'renamed contents\n')
      await write('folder/tracked.txt', 'original\n')
      await write('keep.txt', 'original\n')
      await commit('base')
      await rename(join(repo, 'old.txt'), join(repo, 'new.txt'))
      await write('added.txt', 'added\n')
      await git(repo, ['add', '-A'])
      await write('added.txt', 'added after staging\n')
      await write('folder/tracked.txt', 'changed\n')
      await write('folder/untracked.txt', 'untracked\n')
      await write('untracked.txt', 'untracked\n')
      await write('keep.txt', 'keep changed\n')
      await runAction(repo, 'discard', {
        paths: ['old.txt', 'new.txt', 'added.txt', 'untracked.txt', 'folder'],
      })
      expect(await read('old.txt')).toBe('renamed contents\n')
      expect(await read('folder/tracked.txt')).toBe('original\n')
      for (const path of ['new.txt', 'added.txt', 'untracked.txt', 'folder/untracked.txt'])
        await expect(read(path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('')
      expect(await read('keep.txt')).toBe('keep changed\n')
    })

    it('handles newline filenames on platforms that support them', async (context) => {
      if (process.platform === 'win32') return context.skip()
      await write('line\nbreak.txt', 'original\n')
      await commit('base')
      await write('line\nbreak.txt', 'changed\n')
      await runAction(repo, 'discard', { paths: ['line\nbreak.txt'] })
      expect(await read('line\nbreak.txt')).toBe('original\n')
    })
  })

  it('stages and unstages only the selected literal filename', async () => {
    await write('[ab].txt', 'original\n')
    await write('a.txt', 'original\n')
    await commit('base')
    await write('[ab].txt', 'selected change\n')
    await write('a.txt', 'other change\n')
    await runAction(repo, 'stage', { paths: ['[ab].txt'] })
    expect(await git(repo, ['show', ':[ab].txt'])).toBe('selected change\n')
    expect(await git(repo, ['show', ':a.txt'])).toBe('original\n')
    await git(repo, ['add', '-A'])
    await runAction(repo, 'unstage', { paths: ['[ab].txt'] })
    expect(await git(repo, ['show', ':[ab].txt'])).toBe('original\n')
    expect(await git(repo, ['show', ':a.txt'])).toBe('other change\n')
    expect(await read('[ab].txt')).toBe('selected change\n')
  })

  it('amends without an explicit message while preserving the previous message and parents', async () => {
    await write('file.txt', 'base\n')
    await commit('base')
    await write('file.txt', 'first change\n')
    await commit('message to preserve')
    const original = (await git(repo, ['rev-parse', 'HEAD'])).trim()
    const parents = await git(repo, ['show', '-s', '--format=%P'])
    await write('file.txt', 'amended change\n')
    await git(repo, ['add', 'file.txt'])
    const request = decodeActionRequest({ repo, action: 'commit', args: { amend: true } })
    await runAction(request.repo, request.action, request.args)
    expect((await git(repo, ['rev-parse', 'HEAD'])).trim()).not.toBe(original)
    expect(await git(repo, ['show', '-s', '--format=%s'])).toBe('message to preserve\n')
    expect(await git(repo, ['show', '-s', '--format=%P'])).toBe(parents)
    expect(await git(repo, ['show', 'HEAD:file.txt'])).toBe('amended change\n')
  })

  it('completes a resolved merge using its prepared message', async () => {
    await write('conflict.txt', 'base\n')
    await commit('base')
    await git(repo, ['checkout', '-b', 'feature'])
    await write('conflict.txt', 'feature\n')
    await commit('feature')
    await git(repo, ['checkout', 'main'])
    await write('conflict.txt', 'main\n')
    await commit('main')
    await git(repo, ['merge', 'feature'], { allowCodes: [1] })
    await write('conflict.txt', 'resolved\n')
    await git(repo, ['add', 'conflict.txt'])
    await expect(runAction(repo, 'commit', { message: '' })).rejects.toThrow(
      'Commit message is required',
    )
    await runAction(repo, 'commit', { messageMode: 'prepared' })
    expect((await git(repo, ['show', '-s', '--format=%s'])).trim()).toBe("Merge branch 'feature'")
    expect((await git(repo, ['show', '-s', '--format=%P'])).trim().split(' ')).toHaveLength(2)
    expect(await read('conflict.txt')).toBe('resolved\n')
    await expect(runAction(repo, 'commit', { messageMode: 'prepared' })).rejects.toThrow(
      'No merge is in progress',
    )
  })
})

describe('action JSON boundary', () => {
  it.each([
    null,
    { repo: '.', action: 'toString', args: {} },
    { repo: '.', action: 'discard', args: { paths: [] } },
    { repo: '.', action: 'discard', args: { paths: ['valid', false] } },
    { repo: '.', action: 'deleteRemoteTag', args: { remote: true, name: 'v1' } },
    { repo: '.', action: 'push', args: { remote: 'origin' } },
    {
      repo: '.',
      action: 'editRemote',
      args: { name: 'origin', url: 'valid-url', newName: '--invalid' },
    },
    { repo: '.', action: 'discardAll', args: { includeUntracked: 'true' } },
    { repo: '.', action: 'reset', args: { hash: 'HEAD', mode: 'invalid' } },
    { repo: '.', action: 'commit', args: { messageMode: 'prepared', amend: true } },
    { repo: '.', action: 'commit', args: { allowEmpty: true } },
    { repo: '.', action: 'cherryPick', args: { hash: 'HEAD', mainline: '0' } },
    { repo: '.', action: 'stageAll', args: { surprise: true } },
  ])('rejects malformed requests before dispatch: %j', (request) => {
    expect(() => decodeActionRequest(request)).toThrow()
  })
  it('accepts omitted args for operations without required arguments', () => {
    expect(decodeActionRequest({ repo: '.', action: 'stageAll' })).toEqual({
      repo: '.',
      action: 'stageAll',
      args: {},
    })
    expect(() => decodeActionRequest({ repo: '.', action: 'discard' })).toThrow()
  })
  it('retains existing API options and explicit message modes', () => {
    const repo = '.'
    for (const request of [
      { repo, action: 'fetch', args: { pruneTags: true } },
      { repo, action: 'push', args: { remote: 'origin', branch: 'main', forceUnsafe: true } },
      { repo, action: 'pruneRemote', args: { name: 'origin' } },
      { repo, action: 'rebase', args: { ref: 'main', ignoreDate: true } },
      { repo, action: 'commit', args: { message: 'message', signoff: true } },
      { repo, action: 'commit', args: { messageMode: 'prepared' } },
    ])
      expect(decodeActionRequest(request)).toEqual(request)
  })
})
