import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ChangedFile,
  CommitDetails,
  CommitStats,
  CompareDetails,
  FileDiffRequest,
  FileDiffResponse,
  FileStatus,
  GitCommit,
  GitRef,
  GraphData,
  GraphRequest,
  Remote,
  RepoState,
  StashInfo,
  UncommittedDetails,
  UncommittedFile,
  UpstreamInfo,
} from '../shared/types.ts'
import { git, gitOrNull, gitRaw, assertSafeArg } from './git.ts'

const FS = '\x1f' // field separator
const RS = '\x1e' // record separator

// ---------------------------------------------------------------------------
// Commit metadata records
//
// Commit fields are described declaratively: each key maps to a git
// pretty-format placeholder (https://git-scm.com/docs/pretty-formats). A format
// string is generated from the keys a caller asks for, and the output is parsed
// back into a keyed record, so consumers never depend on field positions.
// Provenance: written for Embegrav; the placeholders are git's public format
// interface, the record shape and the identity/timestamp helpers are our own.
// ---------------------------------------------------------------------------

const COMMIT_PLACEHOLDERS = {
  hash: '%H',
  parents: '%P',
  authorName: '%an',
  authorEmail: '%ae',
  authorDate: '%at',
  committerName: '%cn',
  committerEmail: '%ce',
  committerDate: '%ct',
  subject: '%s',
  body: '%b',
} as const

type CommitField = keyof typeof COMMIT_PLACEHOLDERS
type CommitRecord<K extends CommitField> = Record<K, string>

const GRAPH_FIELDS = [
  'hash',
  'parents',
  'authorName',
  'authorEmail',
  'authorDate',
  'committerName',
  'committerEmail',
  'committerDate',
  'subject',
] as const satisfies readonly CommitField[]

const DETAIL_FIELDS = [...GRAPH_FIELDS, 'body'] as const satisfies readonly CommitField[]

/** Build a `--format=` value: fields separated by FS, records terminated by RS. */
function commitFormat(fields: readonly CommitField[]): string {
  return `--format=${fields.map((f) => COMMIT_PLACEHOLDERS[f]).join(FS)}${RS}`
}

/**
 * Split git output into keyed records. The last requested field may contain
 * the separator itself (e.g. a body), so it receives the remainder of the record.
 */
function parseCommitRecords<K extends CommitField>(
  out: string,
  fields: readonly K[],
): CommitRecord<K>[] {
  const records: CommitRecord<K>[] = []
  for (const raw of out.split(RS)) {
    const text = raw.replace(/^\r?\n/, '')
    if (text.trim() === '') continue
    const values = text.split(FS)
    if (values.length < fields.length) continue
    const record = {} as CommitRecord<K>
    fields.forEach((field, i) => {
      record[field] = i === fields.length - 1 ? values.slice(i).join(FS) : values[i]
    })
    records.push(record)
  }
  return records
}

interface Identity {
  name: string
  email: string
  /** unix seconds */
  time: number
}

function identity(name: string, email: string, unixSeconds: string): Identity {
  const time = Number.parseInt(unixSeconds, 10)
  return { name, email, time: Number.isFinite(time) ? time : 0 }
}

function parentList(value: string): string[] {
  return value.split(' ').filter((h) => h.length > 0)
}

function toGitCommit(r: CommitRecord<(typeof GRAPH_FIELDS)[number]>): GitCommit {
  const author = identity(r.authorName, r.authorEmail, r.authorDate)
  const committer = identity(r.committerName, r.committerEmail, r.committerDate)
  return {
    hash: r.hash,
    parents: parentList(r.parents),
    author: author.name,
    email: author.email,
    date: author.time,
    committer: committer.name,
    committerEmail: committer.email,
    commitDate: committer.time,
    subject: r.subject,
  }
}

// ---------------------------------------------------------------------------
// Refs / HEAD / stashes
// ---------------------------------------------------------------------------

export async function getRefs(repo: string): Promise<GitRef[]> {
  const out = await git(repo, [
    'for-each-ref',
    '--format=%(objectname)%00%(refname)%00%(*objectname)%00%(upstream:remotename)%00%(upstream:short)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])
  const refs: GitRef[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [hash, refname, peeled, upstreamRemote, upstream] = line.split('\0')
    if (refname.startsWith('refs/heads/')) {
      refs.push({
        name: refname.slice('refs/heads/'.length),
        hash,
        type: 'head',
        remote: upstreamRemote || undefined,
        upstream: upstreamRemote && upstream ? upstream : undefined,
      })
    } else if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice('refs/remotes/'.length)
      if (name.endsWith('/HEAD')) continue
      refs.push({ name, hash, type: 'remote', remote: name.split('/')[0] })
    } else if (refname.startsWith('refs/tags/')) {
      refs.push({
        name: refname.slice('refs/tags/'.length),
        hash: peeled || hash,
        type: 'tag',
        annotated: Boolean(peeled),
      })
    }
  }
  return refs
}

export async function getHead(
  repo: string,
): Promise<{ head: string | null; branch: string | null }> {
  const head = (await gitOrNull(repo, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim() || null
  const branch = (await gitOrNull(repo, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim() || null
  return { head, branch }
}

export async function getStashes(repo: string): Promise<StashInfo[]> {
  const out = await gitOrNull(repo, [
    'reflog',
    'show',
    `--format=%H${FS}%gd${FS}%P${FS}%at${FS}%gs${RS}`,
    'refs/stash',
    '--',
  ])
  if (!out) return []
  const stashes: StashInfo[] = []
  for (const rec of out.split(RS)) {
    const line = rec.trim()
    if (!line) continue
    const [hash, selector, parents, date, subject] = line.split(FS)
    const m = /^stash@\{(\d+)\}$/.exec(selector)
    stashes.push({
      hash,
      selector,
      index: m ? Number(m[1]) : stashes.length,
      baseHash: parents.split(' ')[0] ?? '',
      message: subject,
      date: Number(date),
    })
  }
  return stashes
}

export async function getRemotes(repo: string): Promise<Remote[]> {
  const out = (await gitOrNull(repo, ['remote', '-v'])) ?? ''
  const remotes = new Map<string, string>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(.*) \((fetch|push)\)$/.exec(line)
    if (m && (m[3] === 'fetch' || !remotes.has(m[1]))) remotes.set(m[1], m[2])
  }
  return [...remotes].map(([name, url]) => ({ name, url }))
}

export async function getState(repo: string, head: string | null): Promise<RepoState> {
  const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim()
  const exists = async (p: string) => {
    try {
      await stat(join(gitDir, p))
      return true
    } catch {
      return false
    }
  }
  const [merge, rebaseMerge, rebaseApply, cherry, revert] = await Promise.all([
    exists('MERGE_HEAD'),
    exists('rebase-merge'),
    exists('rebase-apply'),
    exists('CHERRY_PICK_HEAD'),
    exists('REVERT_HEAD'),
  ])
  return {
    mergeInProgress: merge,
    rebaseInProgress: rebaseMerge || rebaseApply,
    cherryPickInProgress: cherry,
    revertInProgress: revert,
    isEmpty: head === null,
  }
}

async function getUpstream(repo: string, branch: string | null): Promise<UpstreamInfo | null> {
  if (!branch) return null
  const name = (
    await gitOrNull(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  )?.trim()
  if (!name) return null
  const counts = (
    await gitOrNull(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  )?.trim()
  if (!counts) return { name, ahead: 0, behind: 0 }
  const [ahead, behind] = counts.split(/\s+/).map(Number)
  return { name, ahead, behind }
}

// ---------------------------------------------------------------------------
// Working tree status
// ---------------------------------------------------------------------------

export async function getUncommitted(repo: string, paths?: string[]): Promise<UncommittedFile[]> {
  const out = await git(repo, [
    '--literal-pathspecs',
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
    '--no-renames',
    '--',
    ...(paths ?? []),
  ])
  const entries = out.split('\0')
  const files: UncommittedFile[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    const kind = e[0]
    if (kind === '1') {
      const m = /^1 (\S)(\S) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(e)
      if (m)
        files.push({ path: m[3], index: m[1], work: m[2], untracked: false, conflicted: false })
    } else if (kind === 'u') {
      const m = /^u (\S)(\S) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(e)
      if (m) files.push({ path: m[3], index: m[1], work: m[2], untracked: false, conflicted: true })
    } else if (kind === '?') {
      files.push({ path: e.slice(2), index: '.', work: '?', untracked: true, conflicted: false })
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// Graph (commit log)
// ---------------------------------------------------------------------------

function parseLog(out: string): GitCommit[] {
  return parseCommitRecords(out, GRAPH_FIELDS).map(toGitCommit)
}

export async function getGraph(req: GraphRequest): Promise<GraphData> {
  const repo = req.repo
  const [{ head, branch }, refs, stashesAll, uncommitted, remotes, config] = await Promise.all([
    getHead(repo),
    getRefs(repo),
    req.showStashes ? getStashes(repo) : Promise.resolve([]),
    getUncommitted(repo),
    getRemotes(repo),
    getUserConfig(repo),
  ])
  const [state, upstream] = await Promise.all([getState(repo, head), getUpstream(repo, branch)])

  const orderFlag =
    req.order === 'topo'
      ? '--topo-order'
      : req.order === 'author-date'
        ? '--author-date-order'
        : '--date-order'
  // Each stash contributes at most two hidden commits (index and untracked files).
  // Include room for every helper so the extra visible commit still proves there is more history.
  const rawLimit = req.maxCommits + 1 + 2 * stashesAll.length
  const args = ['log', `--max-count=${rawLimit}`, orderFlag, commitFormat(GRAPH_FIELDS)]
  const revs: string[] = []
  if (req.branches === null) {
    revs.push('--branches')
    if (req.showRemoteBranches) revs.push('--remotes')
    if (req.showTags) revs.push('--tags')
  } else {
    for (const b of req.branches) {
      if (refs.some((r) => (r.type === 'head' || r.type === 'remote') && r.name === b)) {
        revs.push(b)
      }
    }
  }
  if (head) revs.push('HEAD')
  const stashes = stashesAll.filter((s) => s.hash && s.baseHash)
  for (const s of stashes) revs.push(s.hash)

  let commits: GitCommit[] = []
  if (revs.length > 0) {
    const out = await git(repo, [...args, ...revs, '--'])
    commits = parseLog(out)
  }

  // Stash commits: keep only the base parent, and hide their index/untracked helper commits.
  const stashByHash = new Map(stashes.map((s) => [s.hash, s]))
  const hidden = new Set<string>()
  for (const c of commits) {
    const s = stashByHash.get(c.hash)
    if (s) {
      for (const p of c.parents.slice(1)) hidden.add(p)
      c.parents = c.parents.slice(0, 1)
      c.stash = s
      c.subject = s.message
    }
  }
  if (hidden.size) {
    // Only hide helper commits that nothing else points to.
    const referenced = new Set<string>()
    for (const c of commits) if (!c.stash) for (const p of c.parents) referenced.add(p)
    for (const r of refs) referenced.add(r.hash)
    commits = commits.filter((c) => !(hidden.has(c.hash) && !referenced.has(c.hash)))
  }

  const moreAvailable = commits.length > req.maxCommits
  if (moreAvailable) commits = commits.slice(0, req.maxCommits)

  return {
    commits,
    head,
    currentBranch: branch,
    refs: refs.filter(
      (r) => (req.showRemoteBranches || r.type !== 'remote') && (req.showTags || r.type !== 'tag'),
    ),
    stashes,
    uncommitted,
    moreAvailable,
    remotes,
    state,
    upstream,
    userName: config.name,
    userEmail: config.email,
  }
}

async function getUserConfig(repo: string): Promise<{ name: string; email: string }> {
  const [name, email] = await Promise.all([
    gitOrNull(repo, ['config', '--get', 'user.name']),
    gitOrNull(repo, ['config', '--get', 'user.email']),
  ])
  return { name: name?.trim() ?? '', email: email?.trim() ?? '' }
}

// ---------------------------------------------------------------------------
// Changed files
// ---------------------------------------------------------------------------

type DiffStat = { additions: number | null; deletions: number | null }

function parseNumstat(out: string): Map<string, DiffStat> {
  const map = new Map<string, DiffStat>()
  const entries = out.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(e)
    if (!m) continue
    const additions = m[1] === '-' ? null : Number(m[1])
    const deletions = m[2] === '-' ? null : Number(m[2])
    if (m[3] === '') {
      i += 2 // Skip the source path and consume the destination path.
      map.set(entries[i], { additions, deletions })
    } else {
      map.set(m[3], { additions, deletions })
    }
  }
  return map
}

function parseNameStatus(out: string): ChangedFile[] {
  const files: ChangedFile[] = []
  const entries = out.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const st = entries[i]
    if (!st) continue
    const letter = st[0] as FileStatus
    if (letter === 'R' || letter === 'C') {
      const oldPath = entries[++i]
      const path = entries[++i]
      files.push({ path, oldPath, status: letter, additions: null, deletions: null })
    } else {
      const path = entries[++i]
      files.push({ path, status: letter, additions: null, deletions: null })
    }
  }
  return files
}

async function diffFiles(repo: string, rangeArgs: string[]): Promise<ChangedFile[]> {
  const [names, nums] = await Promise.all([
    git(repo, ['diff', '--name-status', '-z', '-M', ...rangeArgs]),
    git(repo, ['diff', '--numstat', '-z', '-M', ...rangeArgs]),
  ])
  const files = parseNameStatus(names)
  const stats = parseNumstat(nums)
  for (const f of files) {
    const s = stats.get(f.path)
    if (s) {
      f.additions = s.additions
      f.deletions = s.deletions
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function getEmptyTree(repo: string): Promise<string> {
  return (await git(repo, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).trim()
}

export async function getCommitDetails(repo: string, hash: string): Promise<CommitDetails> {
  assertSafeArg(hash, 'hash')
  const out = await git(repo, ['show', '-s', commitFormat(DETAIL_FIELDS), hash, '--'])
  const record = parseCommitRecords(out, DETAIL_FIELDS)[0]
  if (!record) throw new Error(`Commit not found: ${hash}`)
  const commit = toGitCommit(record)
  const base = commit.parents[0] ?? (await getEmptyTree(repo))
  const files = await diffFiles(repo, [base, commit.hash])
  return { ...commit, body: record.body.replace(/\n+$/, ''), files }
}

const SHORTSTAT_RE =
  /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/

/**
 * Change summary for many commits in one git invocation. Merge commits are
 * compared with their first parent, matching the details view.
 */
export async function getCommitStats(
  repo: string,
  hashes: string[],
): Promise<Record<string, CommitStats>> {
  const valid = hashes.filter((h) => /^[0-9a-f]{4,64}$/i.test(h))
  const stats: Record<string, CommitStats> = {}
  if (valid.length > 0) {
    const out = await git(
      repo,
      [
        'log',
        '--no-walk=unsorted',
        '--stdin',
        '--diff-merges=first-parent',
        '-M',
        '--shortstat',
        `--format=${RS}%H`,
      ],
      { input: valid.join('\n') + '\n' },
    )
    for (const chunk of out.split(RS)) {
      const text = chunk.trim()
      if (!text) continue
      const [hash, ...rest] = text.split('\n')
      const m = SHORTSTAT_RE.exec(rest.join('\n'))
      stats[hash] = m
        ? { files: Number(m[1]), additions: Number(m[2] ?? 0), deletions: Number(m[3] ?? 0) }
        : { files: 0, additions: 0, deletions: 0 }
    }
  }
  if (hashes.includes('UNCOMMITTED')) {
    const status = await getUncommitted(repo)
    const head = await gitOrNull(repo, ['rev-parse', '--verify', '-q', 'HEAD'])
    const summary = head ? await gitOrNull(repo, ['diff', '--shortstat', '-M', 'HEAD']) : null
    const m = summary ? SHORTSTAT_RE.exec(summary) : null
    stats.UNCOMMITTED = {
      files: status.length,
      additions: m ? Number(m[2] ?? 0) : 0,
      deletions: m ? Number(m[3] ?? 0) : 0,
    }
  }
  return stats
}

export async function getCompare(repo: string, from: string, to: string): Promise<CompareDetails> {
  assertSafeArg(from, 'from')
  assertSafeArg(to, 'to')
  return { from, to, files: await diffFiles(repo, [from, to]) }
}

function statusFromLetter(index: string, work: string, untracked: boolean): FileStatus {
  if (untracked) return '?'
  const l = index !== '.' ? index : work
  switch (l) {
    case 'A':
    case 'M':
    case 'D':
    case 'R':
    case 'C':
    case 'T':
    case 'U':
      return l
    default:
      return 'M'
  }
}

export async function getUncommittedDetails(repo: string): Promise<UncommittedDetails> {
  const { head } = await getHead(repo)
  const status = await getUncommitted(repo)
  const [stagedStats, unstagedStats] = await Promise.all([
    head
      ? git(repo, ['diff', '--numstat', '-z', '-M', '--cached', 'HEAD']).then(parseNumstat)
      : Promise.resolve(new Map<string, DiffStat>()),
    git(repo, ['diff', '--numstat', '-z', '-M']).then(parseNumstat),
  ])
  const staged: ChangedFile[] = []
  const unstaged: ChangedFile[] = []
  for (const f of status) {
    if (f.conflicted) {
      unstaged.push({ path: f.path, status: 'U', additions: null, deletions: null, staged: false })
      continue
    }
    if (f.index !== '.' && !f.untracked) {
      const s = stagedStats.get(f.path)
      staged.push({
        path: f.path,
        status: statusFromLetter(f.index, '.', false),
        additions: s?.additions ?? null,
        deletions: s?.deletions ?? null,
        staged: true,
      })
    }
    if (f.work !== '.') {
      const s = unstagedStats.get(f.path)
      unstaged.push({
        path: f.path,
        status: statusFromLetter('.', f.work, f.untracked),
        additions: s?.additions ?? null,
        deletions: s?.deletions ?? null,
        staged: false,
      })
    }
  }
  const byPath = (a: ChangedFile, b: ChangedFile) => a.path.localeCompare(b.path)
  return { head, staged: staged.sort(byPath), unstaged: unstaged.sort(byPath) }
}

// ---------------------------------------------------------------------------
// File diffs and contents
// ---------------------------------------------------------------------------

export async function getFileDiff(req: FileDiffRequest): Promise<FileDiffResponse> {
  const { repo, path } = req
  if (typeof path !== 'string' || !path) throw new Error('path is required')
  const paths = req.oldPath && req.oldPath !== path ? [req.oldPath, path] : [path]
  let args: string[]
  if (req.to === 'WORKING' && req.untracked) {
    const r = await gitRaw(repo, ['diff', '--no-index', '--', '/dev/null', path], {
      allowCodes: [1],
    })
    return { patch: r.stdout, binary: /^Binary files/m.test(r.stdout) }
  }
  if (req.from === 'INDEX' && req.to === 'WORKING') {
    args = ['diff', '-M', '--', ...paths]
  } else if (req.to === 'WORKING') {
    const from = req.from === 'HEAD' ? 'HEAD' : assertSafeArg(req.from, 'from')
    args = ['diff', '-M', from, '--', ...paths]
  } else if (req.to === 'INDEX') {
    const from = req.from === 'HEAD' ? 'HEAD' : assertSafeArg(req.from, 'from')
    const head = await gitOrNull(repo, ['rev-parse', '--verify', '-q', 'HEAD'])
    args = head
      ? ['diff', '-M', '--cached', from, '--', ...paths]
      : ['diff', '-M', '--cached', await getEmptyTree(repo), '--', ...paths]
  } else {
    const from = req.from === 'EMPTY' ? await getEmptyTree(repo) : assertSafeArg(req.from, 'from')
    const to = assertSafeArg(req.to, 'to')
    args = ['diff', '-M', from, to, '--', ...paths]
  }
  const patch = await git(repo, args)
  return { patch, binary: /^Binary files .* differ$/m.test(patch) }
}

export async function getFileContent(
  repo: string,
  rev: string,
  path: string,
): Promise<string | null> {
  if (typeof path !== 'string' || !path || path.startsWith('-')) throw new Error('invalid path')
  if (rev === 'WORKING') {
    try {
      const buf = await readFile(join(repo, path))
      if (buf.includes(0)) return null
      return buf.toString('utf8')
    } catch {
      return null
    }
  }
  if (rev === 'EMPTY') return ''
  const spec = rev === 'INDEX' ? `:${path}` : `${assertSafeArg(rev, 'rev')}:${path}`
  try {
    const r = await gitRaw(repo, ['show', spec])
    if (r.stdout.includes('\0')) return null
    return r.stdout
  } catch {
    return null
  }
}
