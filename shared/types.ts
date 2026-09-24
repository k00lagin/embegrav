import type { UndoStep } from './actions.ts'

// Types shared between the server and the web client.

export interface RepoInfo {
  path: string
  name: string
}

export interface StashInfo {
  /** e.g. stash@{0} */
  selector: string
  index: number
  hash: string
  baseHash: string
  message: string
  date: number
}

export interface GitCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  /** author date, unix seconds */
  date: number
  committer: string
  committerEmail: string
  commitDate: number
  subject: string
  stash?: StashInfo
}

export type RefType = 'head' | 'remote' | 'tag'

export interface GitRef {
  /** Short name: "main", "origin/main", "v1.0" */
  name: string
  hash: string
  type: RefType
  /** For remote refs: remote name; for local heads: upstream remote name if set */
  remote?: string
  /** For local heads: short upstream name ("origin/main") if set */
  upstream?: string
  annotated?: boolean
}

export interface UncommittedFile {
  path: string
  /** index (staged) status letter, '.' when unchanged */
  index: string
  /** work-tree status letter, '.' when unchanged */
  work: string
  untracked: boolean
  conflicted: boolean
}

export interface RepoState {
  mergeInProgress: boolean
  rebaseInProgress: boolean
  cherryPickInProgress: boolean
  revertInProgress: boolean
  isEmpty: boolean
}

export interface Remote {
  name: string
  url: string
}

export interface UpstreamInfo {
  name: string
  ahead: number
  behind: number
}

export type CommitOrder = 'date' | 'author-date' | 'topo'

export interface GraphRequest {
  repo: string
  maxCommits: number
  showRemoteBranches: boolean
  /** null = all branches */
  branches: string[] | null
  order: CommitOrder
  showStashes: boolean
  showTags: boolean
}

export interface GraphData {
  commits: GitCommit[]
  head: string | null
  currentBranch: string | null
  refs: GitRef[]
  stashes: StashInfo[]
  uncommitted: UncommittedFile[]
  moreAvailable: boolean
  remotes: Remote[]
  state: RepoState
  upstream: UpstreamInfo | null
  userName: string
  userEmail: string
}

/** Per-commit change summary (diff against the first parent). */
export interface CommitStats {
  files: number
  additions: number
  deletions: number
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

export interface ChangedFile {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number | null
  deletions: number | null
  /** Only for uncommitted changes: true when the change is in the index */
  staged?: boolean
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number
  committer: string
  committerEmail: string
  commitDate: number
  subject: string
  body: string
  files: ChangedFile[]
}

export interface UncommittedDetails {
  head: string | null
  staged: ChangedFile[]
  unstaged: ChangedFile[]
}

export interface CompareDetails {
  from: string
  to: string
  files: ChangedFile[]
}

export interface FileDiffRequest {
  repo: string
  path: string
  oldPath?: string
  from: string
  to: string
  untracked?: boolean
}

export interface FileDiffResponse {
  patch: string
  binary: boolean
}

export interface ActionResult {
  ok: boolean
  output: string
  /** Present when the action can be reverted (hard reset, drop commit, delete branch, discard) */
  undo?: UndoStep
}
