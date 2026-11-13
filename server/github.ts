import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { ActionArgs } from '../shared/actions.ts'
import { GITHUB_OWNER_RE, GITHUB_REPO_NAME_RE, type GitHubVia } from '../shared/github.ts'
import type { GitHubAccount, GitHubRepoMatch } from '../shared/types.ts'
import { assertSafeArg, git, gitOrNull, gitOutput, gitRaw } from './git.ts'

/** Runs the GitHub CLI and resolves with stdout; rejects with a readable message. */
export type GhRunner = (args: string[]) => Promise<string>

/**
 * Reads the stored GitHub credential. When interactive, Git Credential Manager
 * signs in if there is none.
 */
export type CredentialReader = (
  interactive: boolean,
) => Promise<{ username?: string; password: string }>

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
 * stored and `interactive` is set. Read-only: the credential is neither
 * approved nor rejected.
 */
export const readGitHubCredential: CredentialReader = async (interactive) => {
  const out = await git(homedir(), ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    // An empty GIT_ASKPASS also suppresses core.askPass and SSH_ASKPASS, so an
    // editor's askpass helper cannot prompt for a username either.
    env: interactive ? undefined : { GCM_INTERACTIVE: 'never', GIT_ASKPASS: '' },
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

/** The fields of GitHub's repository object used here. */
interface RepoData {
  full_name?: string
  html_url?: string
  clone_url?: string
  ssh_url?: string
}

type RepoUrls = Required<Pick<RepoData, 'html_url' | 'clone_url' | 'ssh_url'>>

/** One way of authenticating against GitHub's API. */
interface Strategy {
  via: GitHubVia
  login: () => Promise<string>
  /** Organizations the user belongs to (best effort) */
  orgs: () => Promise<string[]>
  /** Look up a repository; rejects when it does not exist or is not visible */
  repo: (owner: string, name: string) => Promise<RepoData>
  /** Create the repository */
  create: (repo: NewRepo, login: string) => Promise<RepoUrls>
  /** The URL git uses for a repository */
  remoteUrl: (repo: RepoUrls) => Promise<string>
}

const endpointFor = (repo: NewRepo, login: string) =>
  !repo.owner || repo.owner === login ? 'user/repos' : `orgs/${repo.owner}/repos`

function checkUrls(repo: RepoData): RepoUrls {
  if (!repo.html_url || !repo.clone_url || !repo.ssh_url)
    throw new Error('GitHub returned no repository URL')
  return repo as RepoUrls
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
    repo: async (owner, name) => JSON.parse(await gh(['api', `repos/${owner}/${name}`])),
    async create(repo, login) {
      const fields = ['-f', `name=${repo.name}`, '-F', `private=${repo.visibility === 'private'}`]
      if (repo.description) fields.push('-f', `description=${repo.description}`)
      return checkUrls(
        JSON.parse(await gh(['api', '-X', 'POST', endpointFor(repo, login), ...fields])),
      )
    },
    async remoteUrl(repo) {
      const protocol = (
        await gh(['config', 'get', 'git_protocol', '-h', 'github.com']).catch(() => '')
      ).trim()
      return protocol === 'ssh' ? repo.ssh_url : repo.clone_url
    },
  }
}

/** Git Credential Manager: calls the REST API with GCM's token; remotes use https. */
function gcmStrategy(
  readCredential: CredentialReader,
  fetchImpl: typeof fetch,
  interactive: boolean,
): Strategy {
  let credential: ReturnType<CredentialReader> | undefined
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    credential ??= readCredential(interactive)
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
    repo: (owner, name) => request<RepoData>(`repos/${owner}/${name}`),
    create: async (repo, login) =>
      checkUrls(
        await request<RepoData>(endpointFor(repo, login), {
          name: repo.name,
          private: repo.visibility === 'private',
          ...(repo.description ? { description: repo.description } : {}),
        }),
      ),
    remoteUrl: async (repo) => repo.clone_url,
  }
}

const STRATEGY_LABELS: Record<GitHubVia, string> = {
  gh: 'GitHub CLI',
  gcm: 'Git Credential Manager',
}

/**
 * Sign in with the requested strategy, or try the GitHub CLI first and fall
 * back to Git Credential Manager. Unless `interactive`, only an existing
 * sign-in is used.
 */
async function connect(
  deps: GitHubDeps,
  via?: GitHubVia,
  interactive = true,
): Promise<{ strategy: Strategy; login: string }> {
  const all = [ghStrategy(deps.gh), gcmStrategy(deps.credential, deps.fetch, interactive)]
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
    `Created ${a.visibility} repository ${created.html_url} (via ${STRATEGY_LABELS[strategy.via]})`,
  ]
  try {
    out.push(await gitOutput(repo, ['remote', 'add', remote, await strategy.remoteUrl(created)]))
    if (branch) out.push(await gitOutput(repo, ['push', '-u', remote, branch]))
  } catch (e) {
    throw new Error(`Created ${created.html_url}, but: ${(e as Error).message}`, { cause: e })
  }
  return out.filter(Boolean).join('\n')
}

/**
 * Repositories named `name` (case-insensitively) under the signed-in user or
 * one of their organizations. Never opens a sign-in window: without an existing
 * sign-in, or when GitHub cannot be reached, nothing matches.
 */
export async function findGitHubRepos(
  name: string,
  deps: GitHubDeps = defaultDeps,
): Promise<GitHubRepoMatch[]> {
  if (!GITHUB_REPO_NAME_RE.test(name)) return []
  let connection: Awaited<ReturnType<typeof connect>>
  try {
    connection = await connect(deps, undefined, false)
  } catch {
    return []
  }
  const { strategy, login } = connection
  const lookup = async (owner: string): Promise<GitHubRepoMatch | null> => {
    const found = await strategy.repo(owner, name).catch(() => null)
    const fullName = found?.full_name
    // Renamed and transferred repositories redirect to their new name; only the folder's name counts.
    if (!fullName || fullName.toLowerCase() !== `${owner}/${name}`.toLowerCase()) return null
    return { fullName, via: strategy.via }
  }
  const [own, orgs] = await Promise.all([lookup(login), strategy.orgs().catch(() => [])])
  const inOrgs = await Promise.all(
    orgs.filter((o) => o.toLowerCase() !== login.toLowerCase()).map(lookup),
  )
  return [own, ...inOrgs].filter((m): m is GitHubRepoMatch => m !== null)
}

/**
 * Clone `owner/name` into an empty directory, signing in with the requested
 * strategy. The clone URL follows the strategy the same way publishing does.
 */
export async function cloneFromGitHub(
  directory: string,
  a: { repo: string; via?: GitHubVia },
  deps: GitHubDeps = defaultDeps,
): Promise<string> {
  const [owner, name, ...rest] = a.repo.split('/')
  if (rest.length > 0 || !GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_NAME_RE.test(name ?? ''))
    throw new Error(`"${a.repo}" is not a valid GitHub repository`)
  const { strategy } = await connect(deps, a.via)
  const url = await strategy.remoteUrl(checkUrls(await strategy.repo(owner, name)))
  return gitOutput(directory, ['clone', '--', url, '.'])
}
