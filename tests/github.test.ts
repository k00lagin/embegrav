import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../server/git.ts'
import {
  GH_MISSING,
  cloneFromGitHub,
  findGitHubRepos,
  getGitHubAccount,
  publishToGitHub,
  type GitHubDeps,
} from '../server/github.ts'
import { decodeActionRequest } from '../shared/actions.ts'
import { githubWebUrl } from '../shared/github.ts'

const unused = () => Promise.reject(new Error('unused'))

// Fake GitHub CLI and Git Credential Manager: they record calls and serve
// me/demo from a local repository, so publishing and cloning never contact GitHub.
function fakes(bare: string, opts: { protocol?: string; gh?: boolean; gcm?: boolean } = {}) {
  const gh: string[][] = []
  const http: { url: string; method: string; auth: string; body: unknown }[] = []
  /** The `interactive` flag of every credential read */
  const credentials: boolean[] = []
  const created = {
    full_name: 'me/demo',
    html_url: 'https://github.com/me/demo',
    clone_url: bare,
    ssh_url: 'git@github.com:me/demo.git',
  }
  const deps: GitHubDeps = {
    async gh(args) {
      gh.push(args)
      if (opts.gh === false) throw new Error(GH_MISSING)
      if (args.join(' ') === 'api user --jq .login') return 'me\n'
      if (args[1] === 'user/orgs') return 'acme\n'
      if (args[0] === 'config') return `${opts.protocol ?? 'https'}\n`
      if (args[2] === 'POST') return JSON.stringify(created)
      if (args[0] === 'api' && args[1].toLowerCase() === 'repos/me/demo')
        return JSON.stringify(created)
      if (args[0] === 'api' && args[1].startsWith('repos/'))
        throw new Error('gh: Not Found (HTTP 404)')
      throw new Error(`unexpected gh call: ${args.join(' ')}`)
    },
    async credential(interactive) {
      credentials.push(interactive)
      if (opts.gcm === false) throw new Error('terminal prompts disabled')
      return { username: 'me', password: 'gho_token' }
    },
    async fetch(input, init) {
      const url = String(input)
      const headers = init?.headers as Record<string, string>
      http.push({
        url,
        method: init?.method ?? 'GET',
        auth: headers.authorization,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      const missing = url.includes('/repos/') && !url.toLowerCase().endsWith('/repos/me/demo')
      const json = url.endsWith('/user')
        ? { login: 'me' }
        : url.includes('/user/orgs')
          ? { message: 'Resource not accessible by integration' }
          : missing
            ? { message: 'Not Found' }
            : created
      const status = url.includes('/user/orgs')
        ? 403
        : missing
          ? 404
          : init?.method === 'POST'
            ? 201
            : 200
      return new Response(JSON.stringify(json), { status })
    },
  }
  return { deps, gh, http, credentials }
}

describe('publishing to GitHub', () => {
  let root: string
  let repo: string
  let bare: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'embegrav-github-'))
    repo = join(root, 'work')
    bare = join(root, 'remote.git')
    await git(root, ['init', '-b', 'main', repo])
    await git(root, ['init', '--bare', bare])
    await git(repo, ['config', 'user.name', 'Test'])
    await git(repo, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(repo, 'a.txt'), 'a\n')
    await git(repo, ['add', '-A'])
    await git(repo, ['commit', '-m', 'base'])
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function expectPushed(remote: string) {
    expect((await git(repo, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).trim()).toBe(
      `${remote}/main`,
    )
    expect((await git(bare, ['rev-parse', 'main'])).trim()).toBe(
      (await git(repo, ['rev-parse', 'HEAD'])).trim(),
    )
  }

  describe('with the GitHub CLI', () => {
    it('creates a private repository, adds the remote and pushes with upstream', async () => {
      const { deps, gh, http } = fakes(bare)
      const output = await publishToGitHub(
        repo,
        {
          via: 'gh',
          name: 'demo',
          visibility: 'private',
          remote: 'origin',
          push: true,
          description: '-x',
        },
        deps,
      )
      expect(gh).toContainEqual([
        'api',
        '-X',
        'POST',
        'user/repos',
        '-f',
        'name=demo',
        '-F',
        'private=true',
        '-f',
        'description=-x',
      ])
      expect(http).toEqual([])
      expect(output).toContain(
        'Created private repository https://github.com/me/demo (via GitHub CLI)',
      )
      expect((await git(repo, ['remote', 'get-url', 'origin'])).trim()).toBe(bare)
      await expectPushed('origin')
    })

    it('creates public organization repositories and follows the ssh protocol', async () => {
      const { deps, gh } = fakes(bare, { protocol: 'ssh' })
      await publishToGitHub(
        repo,
        { via: 'gh', name: 'demo', owner: 'acme', visibility: 'public', remote: 'github' },
        deps,
      )
      expect(gh.find((c) => c[2] === 'POST')).toEqual([
        'api',
        '-X',
        'POST',
        'orgs/acme/repos',
        '-f',
        'name=demo',
        '-F',
        'private=false',
      ])
      expect((await git(repo, ['remote', 'get-url', 'github'])).trim()).toBe(
        'git@github.com:me/demo.git',
      )
    })
  })

  describe('with Git Credential Manager', () => {
    it('creates the repository through the REST API with the stored token', async () => {
      const { deps, gh, http } = fakes(bare)
      const output = await publishToGitHub(
        repo,
        {
          via: 'gcm',
          name: 'demo',
          visibility: 'public',
          remote: 'origin',
          push: true,
          description: 'Docs',
        },
        deps,
      )
      expect(gh).toEqual([])
      const auth = `Basic ${Buffer.from('me:gho_token').toString('base64')}`
      expect(http).toEqual([
        { url: 'https://api.github.com/user', method: 'GET', auth, body: undefined },
        {
          url: 'https://api.github.com/user/repos',
          method: 'POST',
          auth,
          body: { name: 'demo', private: false, description: 'Docs' },
        },
      ])
      expect(output).toContain('(via Git Credential Manager)')
      expect((await git(repo, ['remote', 'get-url', 'origin'])).trim()).toBe(bare)
      await expectPushed('origin')
    })

    it('posts organization repositories to the organization endpoint', async () => {
      const { deps, http } = fakes(bare)
      await publishToGitHub(
        repo,
        { via: 'gcm', name: 'demo', owner: 'acme', visibility: 'private', remote: 'origin' },
        deps,
      )
      expect(http.at(-1)).toMatchObject({
        url: 'https://api.github.com/orgs/acme/repos',
        body: { name: 'demo', private: true },
      })
    })

    it('reports GitHub API errors with their details', async () => {
      const { deps } = fakes(bare)
      deps.fetch = async (input) =>
        String(input).endsWith('/user')
          ? new Response(JSON.stringify({ login: 'me' }))
          : new Response(
              JSON.stringify({
                message: 'Repository creation failed.',
                errors: [{ message: 'name already exists on this account' }],
              }),
              { status: 422 },
            )
      await expect(
        publishToGitHub(
          repo,
          { via: 'gcm', name: 'demo', visibility: 'public', remote: 'o' },
          deps,
        ),
      ).rejects.toThrow(
        'GitHub API 422: Repository creation failed.: name already exists on this account',
      )
      expect(await git(repo, ['remote'])).toBe('')
    })
  })

  describe('choosing a strategy', () => {
    it('prefers the GitHub CLI and lists the user before their organizations', async () => {
      const { deps, http } = fakes(bare)
      expect(await getGitHubAccount(deps)).toEqual({
        login: 'me',
        owners: ['me', 'acme'],
        via: 'gh',
      })
      expect(http).toEqual([])
    })

    it('falls back to Git Credential Manager when gh is unavailable', async () => {
      const { deps } = fakes(bare, { gh: false })
      // GCM's OAuth token may lack read:org, so organizations are best effort.
      expect(await getGitHubAccount(deps)).toEqual({ login: 'me', owners: ['me'], via: 'gcm' })
    })

    it('still publishes to the personal account when gh cannot list organizations', async () => {
      const { deps, http } = fakes(bare)
      const gh = deps.gh
      deps.gh = async (args) => {
        if (args[1] === 'user/orgs') throw new Error('HTTP 403: missing read:org scope')
        return gh(args)
      }
      const account = await getGitHubAccount(deps)
      expect(account).toEqual({ login: 'me', owners: ['me'], via: 'gh' })
      await publishToGitHub(
        repo,
        {
          via: account.via,
          owner: account.login,
          name: 'demo',
          visibility: 'private',
          remote: 'origin',
          push: true,
        },
        deps,
      )
      expect(http).toEqual([])
      await expectPushed('origin')
    })

    it('explains both failures when neither strategy can sign in', async () => {
      const { deps } = fakes(bare, { gh: false, gcm: false })
      await expect(getGitHubAccount(deps)).rejects.toThrow(
        `Could not sign in to GitHub.\nGitHub CLI: ${GH_MISSING}\nGit Credential Manager: terminal prompts disabled`,
      )
    })

    it('does not fall back from the strategy the user published with', async () => {
      const { deps, http } = fakes(bare, { gh: false })
      await expect(
        publishToGitHub(repo, { via: 'gh', name: 'demo', visibility: 'public', remote: 'o' }, deps),
      ).rejects.toThrow(GH_MISSING)
      expect(http).toEqual([])
    })
  })

  it('refuses an existing remote name before contacting GitHub', async () => {
    await git(repo, ['remote', 'add', 'origin', bare])
    const deps: GitHubDeps = { gh: unused, credential: unused, fetch: unused }
    await expect(
      publishToGitHub(
        repo,
        { via: 'gcm', name: 'demo', visibility: 'public', remote: 'origin' },
        deps,
      ),
    ).rejects.toThrow('Remote "origin" already exists')
    await expect(
      publishToGitHub(
        repo,
        { via: 'gh', name: 'bad name', visibility: 'public', remote: 'gh' },
        deps,
      ),
    ).rejects.toThrow('not a valid GitHub repository name')
  })

  it.each(['bad name', 'bad..name', 'bad:name', 'bad*name', 'bad.lock', 'bad/'])(
    'rejects remote %s before any GitHub or credential call',
    async (remote) => {
      const deps: GitHubDeps = {
        gh: vi.fn(unused),
        credential: vi.fn(unused),
        fetch: vi.fn(unused),
      }
      const request = decodeActionRequest({
        repo,
        action: 'publishGitHub',
        args: { via: 'gh', name: 'demo', visibility: 'private', remote },
      })
      if (request.action !== 'publishGitHub') throw new Error('Unexpected action')
      await expect(publishToGitHub(repo, request.args, deps)).rejects.toThrow(
        'not a valid remote name',
      )
      expect(deps.gh).not.toHaveBeenCalled()
      expect(deps.credential).not.toHaveBeenCalled()
      expect(deps.fetch).not.toHaveBeenCalled()
      expect(await git(repo, ['remote'])).toBe('')
    },
  )

  it('validates publish requests at the API boundary', () => {
    const base = { repo: '.', action: 'publishGitHub' }
    const args = { via: 'gcm', name: 'x', visibility: 'private', remote: 'origin' }
    expect(() =>
      decodeActionRequest({ ...base, args: { ...args, visibility: 'internal' } }),
    ).toThrow('Invalid argument: visibility')
    expect(() => decodeActionRequest({ ...base, args: { ...args, via: 'token' } })).toThrow(
      'Invalid argument: via',
    )
    expect(() => decodeActionRequest({ ...base, args: { ...args, remote: '-o' } })).toThrow(
      'Invalid argument: remote',
    )
    expect(
      decodeActionRequest({ ...base, args: { ...args, description: '- notes' } }).args,
    ).toMatchObject({ via: 'gcm', description: '- notes' })
  })
})

describe('finding GitHub repositories to clone', () => {
  it('matches user and organization repositories case-insensitively with the GitHub CLI', async () => {
    const { deps, gh, credentials } = fakes('unused')
    expect(await findGitHubRepos('Demo', deps)).toEqual([{ fullName: 'me/demo', via: 'gh' }])
    expect(gh).toContainEqual(['api', 'repos/me/Demo'])
    expect(gh).toContainEqual(['api', 'repos/acme/Demo'])
    expect(credentials).toEqual([])
  })

  it('lists organization matches and ignores redirects to other names', async () => {
    const { deps } = fakes('unused')
    const gh = deps.gh
    deps.gh = async (args) => {
      if (args[1] === 'repos/me/old') return JSON.stringify({ full_name: 'me/renamed' })
      if (args[1] === 'repos/acme/old') return JSON.stringify({ full_name: 'acme/old' })
      return gh(args)
    }
    expect(await findGitHubRepos('old', deps)).toEqual([{ fullName: 'acme/old', via: 'gh' }])
  })

  it('reads the Git Credential Manager token without letting it prompt', async () => {
    const { deps, credentials, http } = fakes('unused', { gh: false })
    expect(await findGitHubRepos('demo', deps)).toEqual([{ fullName: 'me/demo', via: 'gcm' }])
    expect(credentials).toEqual([false])
    expect(http.map((r) => r.url).sort()).toEqual([
      'https://api.github.com/repos/me/demo',
      'https://api.github.com/user',
      'https://api.github.com/user/orgs?per_page=100',
    ])
  })

  it('finds nothing when signed out or for names GitHub does not allow', async () => {
    expect(await findGitHubRepos('demo', fakes('unused', { gh: false, gcm: false }).deps)).toEqual(
      [],
    )
    const deps: GitHubDeps = { gh: vi.fn(unused), credential: vi.fn(unused), fetch: vi.fn(unused) }
    expect(await findGitHubRepos('new project', deps)).toEqual([])
    expect(deps.gh).not.toHaveBeenCalled()
    expect(deps.credential).not.toHaveBeenCalled()
  })
})

describe('cloning from GitHub', () => {
  let root: string
  let source: string
  let target: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'embegrav-clone-'))
    source = join(root, 'source')
    target = join(root, 'demo')
    await git(root, ['init', '-b', 'main', source])
    await git(source, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ])
    await mkdir(target)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.each(['gh', 'gcm'] as const)('clones through the %s strategy', async (via) => {
    const { deps, credentials } = fakes(source)
    await cloneFromGitHub(target, { repo: 'me/demo', via }, deps)
    expect((await git(target, ['rev-parse', 'HEAD'])).trim()).toBe(
      (await git(source, ['rev-parse', 'HEAD'])).trim(),
    )
    expect((await git(target, ['remote', 'get-url', 'origin'])).trim()).toBe(source)
    // Cloning is a user action, so Git Credential Manager may sign in.
    expect(credentials).toEqual(via === 'gcm' ? [true] : [])
  })

  it('reports repositories GitHub does not know', async () => {
    const { deps } = fakes(source)
    await expect(cloneFromGitHub(target, { repo: 'me/other', via: 'gh' }, deps)).rejects.toThrow(
      'Not Found',
    )
    expect(await readdir(target)).toEqual([])
  })

  it.each(['demo', 'me/demo/x', '-x/demo', 'me/bad name'])(
    'rejects %s before any GitHub call',
    async (repo) => {
      const deps: GitHubDeps = {
        gh: vi.fn(unused),
        credential: vi.fn(unused),
        fetch: vi.fn(unused),
      }
      await expect(cloneFromGitHub(target, { repo }, deps)).rejects.toThrow(
        'is not a valid GitHub repository',
      )
      expect(deps.gh).not.toHaveBeenCalled()
      expect(deps.credential).not.toHaveBeenCalled()
      expect(deps.fetch).not.toHaveBeenCalled()
    },
  )
})

describe('githubWebUrl', () => {
  it('maps github.com remotes in every URL form to the repository page', () => {
    for (const url of [
      'https://github.com/me/demo.git',
      'https://github.com/me/demo',
      'https://token@github.com/me/demo.git/',
      'git@github.com:me/demo.git',
      'ssh://git@github.com:22/me/demo.git',
      'git://github.com/me/demo',
    ])
      expect(githubWebUrl(url), url).toBe('https://github.com/me/demo')
    expect(githubWebUrl('git@github.com:me/my.repo.git')).toBe('https://github.com/me/my.repo')
  })

  it('returns null for other hosts and non-repository paths', () => {
    for (const url of [
      'https://gitlab.com/me/demo.git',
      'https://github.com.evil.example/me/demo',
      'https://github.com/me/demo/tree/main',
      'C:/repos/demo',
      '../demo.git',
    ])
      expect(githubWebUrl(url), url).toBeNull()
  })
})
