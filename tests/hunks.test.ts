import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../server/git.ts'
import { getFileDiff } from '../server/repo.ts'
import { runAction } from '../server/actions.ts'
import { decodeActionRequest } from '../shared/actions.ts'
import { splitPatchHunks } from '../shared/patch.ts'

let repo: string
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'embegrav-hunks-'))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.name', 'Test'])
  await git(repo, ['config', 'user.email', 'test@example.com'])
  await git(repo, ['config', 'core.autocrlf', 'false'])
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

const base = Array.from({ length: 32 }, (_, i) => `line ${i + 1}\n`).join('')
const changed = base
  .replace('line 2\n', 'inserted\nchanged 2\n')
  .replace('line 28\n', 'changed 28\n')
const write = (path: string, contents: string) => writeFile(join(repo, path), contents)
const read = (path: string) => readFile(join(repo, path), 'utf8')
const diff = (path: string, staged = false, untracked = false) =>
  getFileDiff({
    repo,
    path,
    from: staged ? 'HEAD' : 'INDEX',
    to: staged ? 'INDEX' : 'WORKING',
    untracked,
  })
async function seed(path = 'file.txt') {
  await write(path, base)
  await git(repo, ['add', '-A'])
  await git(repo, ['commit', '-m', 'base'])
}

it('stages and unstages individual hunks, recalculating offsets and preserving both other changes and the working file', async () => {
  await seed()
  await write('file.txt', changed)
  let { patch } = await diff('file.txt')
  expect(splitPatchHunks(patch)).toHaveLength(2)
  await runAction(repo, 'stageHunk', { path: 'file.txt', patch, hunk: 1 })
  expect(await git(repo, ['show', ':file.txt'])).toBe(base.replace('line 28\n', 'changed 28\n'))
  expect(await read('file.txt')).toBe(changed)
  ;({ patch } = await diff('file.txt'))
  expect(splitPatchHunks(patch)).toHaveLength(1)
  await runAction(repo, 'stageHunk', { path: 'file.txt', patch, hunk: 0 })
  expect(await git(repo, ['show', ':file.txt'])).toBe(changed)
  ;({ patch } = await diff('file.txt', true))
  await runAction(repo, 'unstageHunk', { path: 'file.txt', patch, hunk: 0 })
  expect(await git(repo, ['show', ':file.txt'])).toBe(base.replace('line 28\n', 'changed 28\n'))
  expect(await read('file.txt')).toBe(changed)
  ;({ patch } = await diff('file.txt', true))
  await runAction(repo, 'unstageHunk', { path: 'file.txt', patch, hunk: 0 })
  expect(await git(repo, ['show', ':file.txt'])).toBe(base)
  expect(await read('file.txt')).toBe(changed)
})

it('rejects stale or tampered patches without changing the index', async () => {
  await seed()
  await write('file.txt', changed)
  const { patch } = await diff('file.txt')
  await write('file.txt', changed + 'later edit\n')
  await expect(runAction(repo, 'stageHunk', { path: 'file.txt', patch, hunk: 0 })).rejects.toThrow(
    'diff has changed',
  )
  expect(await git(repo, ['show', ':file.txt'])).toBe(base)
  const current = await diff('file.txt')
  await expect(
    runAction(repo, 'stageHunk', {
      path: 'file.txt',
      patch: current.patch.replace('changed 2', 'injected'),
      hunk: 0,
    }),
  ).rejects.toThrow('diff has changed')
  await expect(
    runAction(repo, 'stageHunk', { path: 'file.txt', patch: current.patch, hunk: 100 }),
  ).rejects.toThrow('whole-file')
  expect(await git(repo, ['show', ':file.txt'])).toBe(base)
})

it('keeps a deletion at EOF without a final newline isolated from another hunk', async () => {
  await seed()
  const contents = changed.replace('line 32\n', 'last line without newline')
  await write('file.txt', contents)
  const { patch } = await diff('file.txt')
  expect(splitPatchHunks(patch)).toHaveLength(2)
  await runAction(repo, 'stageHunk', { path: 'file.txt', patch, hunk: 1 })
  expect(await git(repo, ['show', ':file.txt'])).toBe(
    base.replace('line 28\n', 'changed 28\n').replace('line 32\n', 'last line without newline'),
  )
  expect(await read('file.txt')).toBe(contents)
})

it.each(['[ab].txt', '-leading.txt', 'space name.txt', 'Юникод.txt'])(
  'uses literal paths for %s',
  async (path) => {
    await seed(path)
    await write('a.txt', 'other\n')
    await write(path, changed)
    const { patch } = await diff(path)
    const request = decodeActionRequest({
      repo,
      action: 'stageHunk',
      args: { path, patch, hunk: 0 },
    })
    await runAction(request.repo, request.action, request.args)
    expect(await git(repo, ['diff', '--cached', '--name-only', '-z'])).toBe(path + '\0')
    expect(await read(path)).toBe(changed)
  },
)

it.each(['no trailing newline', 'windows\r\nline endings\r\n'])(
  'handles new files before the first commit: %j',
  async (contents) => {
    await write('new.txt', contents)
    const originalRequest = { repo, path: 'new.txt', from: 'HEAD', to: 'WORKING', untracked: true }
    const { patch } = await getFileDiff(originalRequest)
    await runAction(repo, 'stageHunk', { path: 'new.txt', patch, hunk: 0 })
    expect(await git(repo, ['show', ':new.txt'])).toBe(contents)
    expect((await getFileDiff(originalRequest)).patch).toBe('')
    const staged = await diff('new.txt', true)
    await runAction(repo, 'unstageHunk', { path: 'new.txt', patch: staged.patch, hunk: 0 })
    expect(await git(repo, ['ls-files'])).toBe('')
    expect(await read('new.txt')).toBe(contents)
  },
)

it('handles deleted files while leaving their working-tree deletion untouched', async () => {
  await seed()
  await rm(join(repo, 'file.txt'))
  const { patch } = await diff('file.txt')
  await runAction(repo, 'stageHunk', { path: 'file.txt', patch, hunk: 0 })
  expect(await git(repo, ['ls-files'])).toBe('')
  const staged = await diff('file.txt', true)
  await runAction(repo, 'unstageHunk', { path: 'file.txt', patch: staged.patch, hunk: 0 })
  expect(await git(repo, ['show', ':file.txt'])).toBe(base)
  await expect(read('file.txt')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('ignores user diff presentation settings and leaves executable-bit changes unstaged', async () => {
  await seed()
  await git(repo, ['config', 'diff.noprefix', 'true'])
  await git(repo, ['config', 'diff.context', '50'])
  await git(repo, ['config', 'color.ui', 'always'])
  await git(repo, ['update-index', '--chmod=+x', 'file.txt'])
  await write('file.txt', changed)
  const { patch } = await diff('file.txt')
  expect(splitPatchHunks(patch)).toHaveLength(2)
  await runAction(repo, 'stageHunk', { path: 'file.txt', patch, hunk: 0 })
  expect(await git(repo, ['ls-files', '--stage'])).toMatch(/^100755 /)
})

it.each([-1, 0.5, '0', null])('rejects invalid hunk indices at the JSON boundary: %j', (hunk) => {
  expect(() =>
    decodeActionRequest({
      repo,
      action: 'stageHunk',
      args: { path: 'file.txt', patch: 'diff\n', hunk },
    }),
  ).toThrow('Invalid argument: hunk')
})
