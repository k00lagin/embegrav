import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { ActionArgs } from '../shared/actions.ts'
import { GITHUB_OWNER_RE, GITHUB_REPO_NAME_RE, type GitHubVia } from '../shared/github.ts'
import type { GitHubAccount } from '../shared/types.ts'
import { assertSafeArg, git, gitOrNull, gitOutput, gitRaw } from './git.ts'

/** Runs the GitHub CLI and resolves with stdout; rejects with a readable message. */
export type GhRunner = (args: string[]) => Promise<string>

/** Reads the stored GitHub credential (Git Credential Manager signs in when there is none). */
export type CredentialReader = () => Promise<{ username?: string; password: string }>

/** Everything that talks to the outside world, injectable for tests. */
export interface GitHubDeps {
  gh: GhRunner
  credential: CredentialReader
  fetch: typeof fetch
}

export const GH_MISSING =
  'GitHub CLI (gh) was not found. Install it from https://cli.github.com and run "gh auth login".'

export const runGh: GhRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(GH_MISSING))
        reject(new Error((stderr || stdout || error.message).trim()))
      },
    )
  })

/**
 * `git credential fill` for https://github.com. With Git Credential Manager
 * this returns its OAuth token, or opens GCM's sign-in window when none is
 * stored. Read-only: the credential is neither approved nor rejected.
 */
export const readGitHubCredential: CredentialReader = async () => {
  const out = await git(homedir(), ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
  })
  const fields = new Map(
    out.split(/\r?\n/).flatMap((line) => {
      const i = line.indexOf('=')
      return i > 0 ? [[line.slice(0, i), line.slice(i + 1)] as const] : []
    }),
  )
  const password = fields.get('password')
  if (!password) throw new Error('No GitHub credential is stored')
  return { username: fields.get('username'), password }
}

export const defaultDeps: GitHubDeps = {
  gh: runGh,
  credential: readGitHubCredential,
  fetch: (input, init) => fetch(input, init),
}

interface NewRepo {
  owner?: string
  name: string
  visibility: 'public' | 'private'
  description?: string
}

/** One way of authenticating against GitHub's API. */
interface Strategy {
  via: GitHubVia
  login: () => Promise<string>
  /** Organizations the user belongs to (best effort) */
  orgs: () => Promise<string[]>
  /** Create the repository; returns its web page and the URL to add as a remote */
  create: (repo: NewRepo, login: string) => Promise<{ htmlUrl: string; remoteUrl: string }>
}

interface CreatedRepo {
  html_url?: string
  clone_url?: string
  ssh_url?: string
}

const endpointFor = (repo: NewRepo, login: string) =>
  !repo.owner || repo.owner === login ? 'user/repos' : `orgs/${repo.owner}/repos`

function checkCreated(created: CreatedRepo): Required<CreatedRepo> {
  if (!created.html_url || !created.clone_url || !created.ssh_url)
    throw new Error('GitHub returned no repository URL')
  return created as Required<CreatedRepo>
}

/** GitHub CLI: uses gh's sign-in and its configured git protocol (https or ssh). */
function ghStrategy(gh: GhRunner): Strategy {
  return {
    via: 'gh',
    login: async () => (await gh(['api', 'user', '--jq', '.login'])).trim(),
    orgs: async () =>
      (await gh(['api', 'user/orgs', '--paginate', '--jq', '.[].login']))
        .split(/\r?\n/)
        .map((o) => o.trim())
        .filter(Boolean),
    async create(repo, login) {
      const fields = ['-f', `name=${repo.name}`, '-F', `private=${repo.visibility === 'private'}`]
      if (repo.description) fields.push('-f', `description=${repo.description}`)
      const created = checkCreated(
        JSON.parse(await gh(['api', '-X', 'POST', endpointFor(repo, login), ...fields])),
      )
      const protocol = (
        await gh(['config', 'get', 'git_protocol', '-h', 'github.com']).catch(() => '')
      ).trim()
      return {
        htmlUrl: created.html_url,
        remoteUrl: protocol === 'ssh' ? created.ssh_url : created.clone_url,
      }
    },
  }
}

/** Git Credential Manager: calls the REST API with GCM's token; remotes use https. */
function gcmStrategy(readCredential: CredentialReader, fetchImpl: typeof fetch): Strategy {
  let credential: ReturnType<CredentialReader> | undefined
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    credential ??= readCredential()
    const { username, password } = await credential
    const authorization = username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : `Bearer ${password}`
    const res = await fetchImpl(`https://api.github.com/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization,
        'user-agent': 'embegrav',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as {
      message?: string
      errors?: { message?: string }[]
    } | null
    if (!res.ok) {
      const details = [json?.message, ...(json?.errors ?? []).map((e) => e.message)]
      const message = details.filter(Boolean).join(': ') || res.statusText
      throw new Error(`GitHub API ${res.status}: ${message}`)
    }
    return json as T
  }
  return {
    via: 'gcm',
    login: async () => {
      const login = (await request<{ login?: string }>('user')).login
      if (!login) throw new Error('GitHub did not return the signed-in user')
      return login
    },
    orgs: () =>
      request<{ login: string }[]>('user/orgs?per_page=100').then((orgs) =>
        orgs.map((o) => o.login),
      ),
    async create(repo, login) {
      const created = checkCreated(
        await request<CreatedRepo>(endpointFor(repo, login), {
          name: repo.name,
          private: repo.visibility === 'private',
          ...(repo.description ? { description: repo.description } : {}),
        }),
      )
      return { htmlUrl: created.html_url, remoteUrl: created.clone_url }
    },
  }
}

const STRATEGY_LABELS: Record<GitHubVia, string> = {
  gh: 'GitHub CLI',
  gcm: 'Git Credential Manager',
}

/**
 * Sign in with the requested strategy, or try the GitHub CLI first and fall
 * back to Git Credential Manager.
 */
async function connect(
  deps: GitHubDeps,
  via?: GitHubVia,
): Promise<{ strategy: Strategy; login: string }> {
  const all = [ghStrategy(deps.gh), gcmStrategy(deps.credential, deps.fetch)]
  const candidates = via ? all.filter((s) => s.via === via) : all
  const failures: string[] = []
  for (const strategy of candidates) {
    try {
      return { strategy, login: await strategy.login() }
    } catch (e) {
      failures.push(`${STRATEGY_LABELS[strategy.via]}: ${(e as Error).message}`)
    }
  }
  throw new Error(`Could not sign in to GitHub.\n${failures.join('\n')}`)
}

/** The signed-in GitHub user, the accounts a repository can be created under and the strategy used. */
export async function getGitHubAccount(deps: GitHubDeps = defaultDeps): Promise<GitHubAccount> {
  const { strategy, login } = await connect(deps)
  // Either strategy may lack organization permissions; personal publishing still works.
  const orgs = await strategy.orgs().catch(() => [])
  return { login, owners: [login, ...orgs.filter((o) => o !== login)], via: strategy.via }
}

/**
 * Create a GitHub repository with the requested strategy, add it as a remote
 * and optionally push the current branch with upstream tracking.
 */
export async function publishToGitHub(
  repo: string,
  a: ActionArgs['publishGitHub'],
  deps: GitHubDeps = defaultDeps,
): Promise<string> {
  if (!GITHUB_REPO_NAME_RE.test(a.name))
    throw new Error(`"${a.name}" is not a valid GitHub repository name`)
  if (a.owner && !GITHUB_OWNER_RE.test(a.owner))
    throw new Error(`"${a.owner}" is not a valid GitHub account`)
  const remote = assertSafeArg(a.remote, 'remote')
  const { code } = await gitRaw(repo, ['check-ref-format', `refs/remotes/${remote}/HEAD`], {
    allowCodes: [1],
  })
  if (code !== 0) throw new Error(`"${remote}" is not a valid remote name`)
  const remotes = (await gitOutput(repo, ['remote'])).split(/\r?\n/)
  if (remotes.includes(remote)) throw new Error(`Remote "${remote}" already exists`)
  const branch = a.push
    ? (await gitOrNull(repo, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim()
    : undefined
  if (a.push && !branch) throw new Error('Check out a branch to push it')
  if (branch && !(await gitOrNull(repo, ['rev-parse', '-q', '--verify', 'HEAD'])))
    throw new Error(`Branch ${branch} has no commits to push`)

  const { strategy, login } = await connect(deps, a.via)
  const created = await strategy.create(a, login)
  const out = [
    `Created ${a.visibility} repository ${created.htmlUrl} (via ${STRATEGY_LABELS[strategy.via]})`,
  ]
  try {
    out.push(await gitOutput(repo, ['remote', 'add', remote, created.remoteUrl]))
    if (branch) out.push(await gitOutput(repo, ['push', '-u', remote, branch]))
  } catch (e) {
    throw new Error(`Created ${created.htmlUrl}, but: ${(e as Error).message}`, { cause: e })
  }
  return out.filter(Boolean).join('\n')
}
