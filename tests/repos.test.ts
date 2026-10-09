import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { git } from '../server/git.ts'
import { findRepo, listRepos, registerPath, removeRepo } from '../server/repos.ts'

let root: string
let repo: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'embegrav-resolve-'))
  repo = join(root, 'my repo')
  await mkdir(repo)
  await git(repo, ['init', '-b', 'main'])
})
afterEach(async () => {
  for (const r of listRepos()) removeRepo(r.path)
  await rm(root, { recursive: true, force: true })
})

it('resolves roots and subdirectories without registering or scanning children', async () => {
  await mkdir(join(repo, 'src'))
  const expected = { path: resolve(repo), name: 'my repo' }
  expect(await findRepo(repo)).toEqual(expected)
  expect(await findRepo(join(repo, 'src'))).toEqual(expected)
  expect(await findRepo(root)).toBeNull()
  expect(await findRepo(join(root, 'missing'))).toBeNull()
  await writeFile(join(repo, 'file.txt'), '')
  expect(await findRepo(join(repo, 'file.txt'))).toBeNull()
  expect(listRepos()).toEqual([])
})

it('resolves and registers linked worktrees', async () => {
  await git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'initial',
  ])
  const worktree = join(root, 'worktree')
  await git(repo, ['worktree', 'add', '--detach', worktree])
  const found = await findRepo(worktree)
  expect(found).toEqual({ path: resolve(worktree), name: 'worktree' })
  expect(listRepos()).toEqual([])
  expect(await registerPath(worktree)).toEqual([found])
})

it('reuses a registered root for a pasted subdirectory', async () => {
  await mkdir(join(repo, 'src'))
  const [registered] = await registerPath(repo)
  expect(await findRepo(join(repo, 'src'))).toBe(registered)
  await registerPath(join(repo, 'src'))
  expect(listRepos()).toEqual([registered])
})

it('scans immediate repositories while ignoring files, missing paths and bare repositories', async () => {
  const bare = join(root, 'bare.git')
  await mkdir(bare)
  await git(bare, ['init', '--bare'])
  await mkdir(join(root, 'ordinary-folder'))
  const file = join(root, 'plain.txt')
  await writeFile(file, '')
  expect(await registerPath(root)).toEqual([{ path: resolve(repo), name: 'my repo' }])
  expect(await registerPath(file)).toEqual([])
  expect(await registerPath(join(root, 'missing'))).toEqual([])
  expect(await registerPath(bare)).toEqual([])
})
