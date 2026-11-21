import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git } from '../server/git.ts'
import { listRepoIconFiles, resolveRepoIcon } from '../server/repo-icons.ts'

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>'
let directory: string
let repo: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'embegrav-icons-'))
  repo = join(directory, 'repo')
  await mkdir(repo)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function put(file: string, content = svg) {
  const path = join(repo, file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

it('uses project metadata, then conventional icon paths, then local HTML or TSX links', async () => {
  await put('src/root.tsx', `links: [{ rel: 'icon', href: '/brand%20mark.svg?v=2' }]`)
  await put('public/brand mark.svg')
  expect(await resolveRepoIcon(repo)).toMatchObject({ file: 'public/brand mark.svg' })

  await put('favicon.ico', 'invalid')
  await put('assets/logo.svg')
  expect(await resolveRepoIcon(repo)).toMatchObject({ file: 'assets/logo.svg' })

  await put('t3.json', JSON.stringify({ iconPath: 'public/brand mark.svg' }))
  expect(await resolveRepoIcon(repo)).toEqual({
    file: 'public/brand mark.svg',
    src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  })
  expect(await resolveRepoIcon(repo, undefined, ['public/brand mark.svg'])).toMatchObject({
    file: 'assets/logo.svg',
  })
  expect(await resolveRepoIcon(repo, 'assets/logo.svg')).toMatchObject({ file: 'assets/logo.svg' })
})

it('keeps configured and manually selected image paths inside the repository', async () => {
  await put('../outside.svg')
  await put('../outside/hidden.svg')
  await symlink(join(directory, 'outside'), join(repo, 'linked'), 'junction')
  await put('t3.json', JSON.stringify({ iconPath: '../outside.svg' }))
  await put('index.html', '<link rel="icon" href="https://example.com/icon.svg">')
  expect(await resolveRepoIcon(repo)).toBeNull()
  expect(await resolveRepoIcon(repo, '../outside.svg')).toBeNull()
  expect(await resolveRepoIcon(repo, join(directory, 'outside.svg'))).toBeNull()
  expect(await resolveRepoIcon(repo, 'linked/hidden.svg')).toBeNull()
})

it('lists existing tracked and unignored images for manual selection', async () => {
  await git(repo, ['init', '-b', 'main'])
  await put('another.svg')
  await put('brand/logo.svg')
  await put('deleted.svg')
  await put('ignored/hidden.svg')
  await put('.gitignore', 'ignored/\n')
  await git(repo, ['add', 'brand/logo.svg', 'deleted.svg'])
  await rm(join(repo, 'deleted.svg'))
  expect(await listRepoIconFiles(repo)).toEqual(['another.svg', 'brand/logo.svg'])
})
