import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../server/git.ts'
import { getCommitDetails, getGraph, getUncommitted } from '../server/repo.ts'
import type { GraphRequest } from '../shared/types.ts'

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'embegrav-status-'))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.name', 'Test'])
  await git(repo, ['config', 'user.email', 'test@example.com'])
  await git(repo, ['config', 'core.autocrlf', 'false'])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

async function commit(message: string) {
  await git(repo, ['add', '-A'])
  await git(repo, ['commit', '--allow-empty', '-m', message])
  return (await git(repo, ['rev-parse', 'HEAD'])).trim()
}

function graph(overrides: Partial<GraphRequest> = {}) {
  return getGraph({
    repo,
    maxCommits: 100,
    showRemoteBranches: true,
    branches: null,
    order: 'topo',
    showStashes: true,
    showTags: true,
    ...overrides,
  })
}

describe('repository status', () => {
  it('preserves exact filenames and filters literal paths and folders', async () => {
    const unusual = [' leading space.txt', 'file[1].txt', '-option.txt', '日本語.txt']
    await mkdir(join(repo, 'folder'))
    for (const path of [...unusual, 'file1.txt', 'folder/inside.txt', 'outside.txt']) {
      await writeFile(join(repo, path), 'before\n')
    }
    await commit('base')
    for (const path of [...unusual, 'file1.txt', 'folder/inside.txt', 'outside.txt']) {
      await writeFile(join(repo, path), 'after\n')
    }
    const status = await getUncommitted(repo)
    expect(status.filter((f) => unusual.includes(f.path))).toHaveLength(unusual.length)
    expect(status.every((f) => f.index === '.' && f.work === 'M')).toBe(true)
    expect((await getUncommitted(repo, ['file[1].txt'])).map((f) => f.path)).toEqual([
      'file[1].txt',
    ])
    expect((await getUncommitted(repo, ['folder'])).map((f) => f.path)).toEqual([
      'folder/inside.txt',
    ])
    expect((await getUncommitted(repo, ['-option.txt'])).map((f) => f.path)).toEqual([
      '-option.txt',
    ])
  })

  it('represents staged renames as deletion and addition while committed diffs retain rename counts', async () => {
    await writeFile(join(repo, 'old.txt'), 'one\ntwo\nthree\nfour\nfive\n')
    await writeFile(join(repo, 'other.txt'), 'unchanged\n')
    await commit('base')
    await rename(join(repo, 'old.txt'), join(repo, 'new.txt'))
    await writeFile(join(repo, 'new.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\n')
    await writeFile(join(repo, 'other.txt'), 'changed\nextra\n')
    await git(repo, ['add', '-A'])
    const status = await getUncommitted(repo)
    expect(status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'old.txt', index: 'D' }),
        expect.objectContaining({ path: 'new.txt', index: 'A' }),
      ]),
    )
    const details = await getCommitDetails(repo, await commit('rename and modify'))
    expect(details.files).toEqual([
      expect.objectContaining({
        path: 'new.txt',
        oldPath: 'old.txt',
        status: 'R',
        additions: 1,
        deletions: 0,
      }),
      expect.objectContaining({ path: 'other.txt', additions: 2, deletions: 1 }),
    ])
  })
})

describe('graph visibility', () => {
  it('loads an unborn branch and takes the last configured identity values', async () => {
    await git(repo, ['config', '--add', 'user.name', 'Last name'])
    await git(repo, ['config', '--add', 'user.email', 'last@example.com'])
    const data = await graph()
    expect(data.head).toBeNull()
    expect(data.currentBranch).toBe('main')
    expect(data.commits).toEqual([])
    expect(data.state.isEmpty).toBe(true)
    expect(data.upstream).toBeNull()
    expect(data.userName).toBe('Last name')
    expect(data.userEmail).toBe('last@example.com')
  })

  it('loads upstream counts and keeps detached linked-worktree state separate', async () => {
    const base = await commit('base')
    await git(repo, ['remote', 'add', 'origin', 'https://example.com/repo.git'])
    await git(repo, ['update-ref', 'refs/remotes/origin/main', base])
    await git(repo, ['branch', '--set-upstream-to=origin/main', 'main'])
    const head = await commit('ahead')
    const main = await graph()
    expect(main.head).toBe(head)
    expect(main.upstream).toEqual({ name: 'origin/main', ahead: 1, behind: 0 })
    const worktree = join(repo, 'linked')
    await git(repo, ['worktree', 'add', '--detach', worktree, base])
    await writeFile(join(repo, '.git', 'MERGE_HEAD'), `${base}\n`)
    const detached = await graph({ repo: worktree })
    expect(detached.head).toBe(base)
    expect(detached.currentBranch).toBeNull()
    expect(detached.upstream).toBeNull()
    expect(detached.state.isEmpty).toBe(false)
    expect(detached.state.mergeInProgress).toBe(false)
    expect((await graph()).state.mergeInProgress).toBe(true)
  })

  it('applies tag and remote visibility to refs on branch-reachable commits', async () => {
    const hash = await commit('base')
    await git(repo, ['tag', 'v1'])
    await git(repo, ['update-ref', 'refs/remotes/origin/main', hash])
    const hidden = await graph({ showTags: false, showRemoteBranches: false })
    expect(hidden.commits.map((c) => c.hash)).toContain(hash)
    expect(hidden.refs.map((r) => r.type)).toEqual(['head'])
    const visible = await graph()
    expect(visible.refs.map((r) => r.type).sort()).toEqual(['head', 'remote', 'tag'])
  })

  it('keeps pagination available when stash helpers occupy the raw commit window', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'base\n')
    const hashes = [await commit('base')]
    hashes.push(await commit('second'))
    hashes.push(await commit('third'))
    await writeFile(join(repo, 'tracked.txt'), 'stashed\n')
    await writeFile(join(repo, 'untracked.txt'), 'stash this too\n')
    await git(repo, ['stash', 'push', '-u', '-m', 'saved'])
    const stash = (await git(repo, ['rev-parse', 'refs/stash'])).trim()
    const first = await graph({ maxCommits: 2 })
    expect(first.commits.map((c) => c.hash)).toEqual([stash, hashes[2]])
    expect(first.moreAvailable).toBe(true)
    const all = await graph({ maxCommits: 4 })
    expect(all.commits.map((c) => c.hash)).toEqual([stash, ...hashes.toReversed()])
    expect(all.moreAvailable).toBe(false)
    expect(all.commits[0].parents).toEqual([hashes[2]])
    const withoutStash = await graph({ maxCommits: 3, showStashes: false })
    expect(withoutStash.commits.map((c) => c.hash)).toEqual(hashes.toReversed())
    expect(withoutStash.moreAvailable).toBe(false)
  })
})
