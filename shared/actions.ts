/** Arguments accepted by each Git operation, shared by callers and handlers. */
export interface ActionArgs {
  fetch: { remote?: string; prune?: boolean; pruneTags?: boolean }
  pull: { remote?: string; branch?: string; rebase?: boolean; noFF?: boolean; squash?: boolean }
  push: {
    remote: string
    branch: string
    setUpstream?: boolean
    force?: boolean
    forceUnsafe?: boolean
  }
  pushTag: { remote: string; name: string }
  deleteRemoteBranch: { remote: string; name: string }
  deleteRemoteTag: { remote: string; name: string }
  addRemote: { name: string; url: string }
  editRemote: { name: string; newName?: string; url?: string }
  removeRemote: { name: string }
  pruneRemote: { name: string }
  setUpstream: { branch: string; upstream: string }
  checkoutBranch: { name: string }
  checkoutRemoteBranch: { remoteRef: string; localName: string }
  checkoutCommit: { hash: string }
  createBranch: { name: string; hash: string; checkout?: boolean; force?: boolean }
  deleteBranch: { name: string; force?: boolean }
  renameBranch: { name: string; newName: string }
  merge: { ref: string; noFF?: boolean; squash?: boolean; noCommit?: boolean }
  /** branch: rebase that branch instead of the current one (git rebase <ref> <branch>) */
  rebase: { ref: string; branch?: string; preserveMerges?: boolean; ignoreDate?: boolean }
  cherryPick: { hash: string; mainline?: string; recordOrigin?: boolean; noCommit?: boolean }
  revert: { hash: string; mainline?: string }
  reset: { hash: string; mode: 'soft' | 'mixed' | 'hard' }
  /** Undo step: move the branch (or detached HEAD) back and reapply a working tree snapshot */
  restoreHead: { hash: string; mode: 'soft' | 'mixed' | 'keep'; branch?: string; snapshot?: string }
  /** Undo step: recreate a deleted branch and its upstream */
  restoreBranch: { name: string; hash: string; upstream?: string }
  dropCommit: { hash: string }
  abort: { op: 'merge' | 'rebase' | 'cherry-pick' | 'revert' }
  continue: { op: 'rebase' | 'cherry-pick' | 'revert' }
  skip: { op: 'rebase' | 'cherry-pick' | 'revert' }
  createTag: { name: string; hash: string; message?: string; force?: boolean; annotated?: boolean }
  deleteTag: { name: string }
  stashPush: { message?: string; includeUntracked?: boolean; keepIndex?: boolean }
  stashApply: { selector: string; reinstateIndex?: boolean }
  stashPop: { selector: string; reinstateIndex?: boolean }
  stashDrop: { selector: string }
  stashBranch: { name: string; selector: string }
  stage: { paths: string[] }
  stageAll: Record<string, never>
  unstage: { paths: string[] }
  unstageAll: Record<string, never>
  discard: { paths: string[] }
  discardAll: { includeUntracked?: boolean }
  commit: (
    | { message: string; messageMode?: 'message'; amend?: boolean }
    | { amend: true; message?: string; messageMode?: 'message' }
    | { messageMode: 'prepared'; message?: never; amend?: false }
  ) & { signoff?: boolean; allowEmpty?: boolean }
  resolveConflict: { paths: string[]; side: 'ours' | 'theirs' }
  setUser: { name?: string; email?: string }
}

export type ActionName = keyof ActionArgs
export type ActionRequest = {
  [K in ActionName]: { repo: string; action: K; args: ActionArgs[K] }
}[ActionName]

/** An action that reverses a completed one; offered as "Undo" after dangerous operations. */
export type UndoStep = {
  [K in ActionName]: { label: string; action: K; args: ActionArgs[K] }
}[ActionName]

type Rule = 'string' | 'string?' | 'boolean?' | 'paths' | readonly string[]
const rules = {
  fetch: { remote: 'string?', prune: 'boolean?', pruneTags: 'boolean?' },
  pull: {
    remote: 'string?',
    branch: 'string?',
    rebase: 'boolean?',
    noFF: 'boolean?',
    squash: 'boolean?',
  },
  push: {
    remote: 'string',
    branch: 'string',
    setUpstream: 'boolean?',
    force: 'boolean?',
    forceUnsafe: 'boolean?',
  },
  pushTag: { remote: 'string', name: 'string' },
  deleteRemoteBranch: { remote: 'string', name: 'string' },
  deleteRemoteTag: { remote: 'string', name: 'string' },
  addRemote: { name: 'string', url: 'string' },
  editRemote: { name: 'string', newName: 'string?', url: 'string?' },
  removeRemote: { name: 'string' },
  pruneRemote: { name: 'string' },
  setUpstream: { branch: 'string', upstream: 'string' },
  checkoutBranch: { name: 'string' },
  checkoutRemoteBranch: { remoteRef: 'string', localName: 'string' },
  checkoutCommit: { hash: 'string' },
  createBranch: { name: 'string', hash: 'string', checkout: 'boolean?', force: 'boolean?' },
  deleteBranch: { name: 'string', force: 'boolean?' },
  renameBranch: { name: 'string', newName: 'string' },
  merge: { ref: 'string', noFF: 'boolean?', squash: 'boolean?', noCommit: 'boolean?' },
  rebase: { ref: 'string', branch: 'string?', preserveMerges: 'boolean?', ignoreDate: 'boolean?' },
  cherryPick: {
    hash: 'string',
    mainline: 'string?',
    recordOrigin: 'boolean?',
    noCommit: 'boolean?',
  },
  revert: { hash: 'string', mainline: 'string?' },
  reset: { hash: 'string', mode: ['soft', 'mixed', 'hard'] },
  restoreHead: {
    hash: 'string',
    mode: ['soft', 'mixed', 'keep'],
    branch: 'string?',
    snapshot: 'string?',
  },
  restoreBranch: { name: 'string', hash: 'string', upstream: 'string?' },
  dropCommit: { hash: 'string' },
  abort: { op: ['merge', 'rebase', 'cherry-pick', 'revert'] },
  continue: { op: ['rebase', 'cherry-pick', 'revert'] },
  skip: { op: ['rebase', 'cherry-pick', 'revert'] },
  createTag: {
    name: 'string',
    hash: 'string',
    message: 'string?',
    force: 'boolean?',
    annotated: 'boolean?',
  },
  deleteTag: { name: 'string' },
  stashPush: { message: 'string?', includeUntracked: 'boolean?', keepIndex: 'boolean?' },
  stashApply: { selector: 'string', reinstateIndex: 'boolean?' },
  stashPop: { selector: 'string', reinstateIndex: 'boolean?' },
  stashDrop: { selector: 'string' },
  stashBranch: { name: 'string', selector: 'string' },
  stage: { paths: 'paths' },
  stageAll: {},
  unstage: { paths: 'paths' },
  unstageAll: {},
  discard: { paths: 'paths' },
  discardAll: { includeUntracked: 'boolean?' },
  commit: {
    message: 'string?',
    messageMode: 'string?',
    amend: 'boolean?',
    signoff: 'boolean?',
    allowEmpty: 'boolean?',
  },
  resolveConflict: { paths: 'paths', side: ['ours', 'theirs'] },
  setUser: { name: 'string?', email: 'string?' },
} satisfies { [K in ActionName]: { [P in keyof ActionArgs[K]]-?: Rule } }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validate untrusted JSON before selecting a handler or running Git. */
export function decodeActionRequest(value: unknown): ActionRequest {
  if (!object(value) || typeof value.repo !== 'string' || !value.repo.trim())
    throw new Error('repo is required')
  if (typeof value.action !== 'string' || !Object.hasOwn(rules, value.action))
    throw new Error('Unknown action')
  if (value.args === undefined) value = { ...value, args: {} }
  if (!object(value) || !object(value.args)) throw new Error('args must be an object')
  const schema: Record<string, Rule> = rules[value.action as ActionName]
  for (const key of Object.keys(value.args)) {
    if (!Object.hasOwn(schema, key)) throw new Error(`Unknown argument: ${key}`)
  }
  for (const [key, rule] of Object.entries(schema)) {
    const field = value.args[key]
    if (typeof rule === 'string' && rule.endsWith('?') && field === undefined) continue
    const valid = Array.isArray(rule)
      ? typeof field === 'string' && rule.includes(field)
      : rule === 'boolean?'
        ? typeof field === 'boolean'
        : rule === 'paths'
          ? Array.isArray(field) &&
            field.length > 0 &&
            field.every((p: unknown) => typeof p === 'string' && p.length > 0 && !p.includes('\0'))
          : typeof field === 'string' && !field.includes('\0')
    if (!valid || (rule === 'string' && field === '')) throw new Error(`Invalid argument: ${key}`)
    // Ref-like arguments are passed as Git operands; validate all of them before
    // handlers such as editRemote perform the first of several Git calls.
    if (
      typeof field === 'string' &&
      field &&
      key !== 'message' &&
      value.action !== 'setUser' &&
      (field.startsWith('-') || /[\n\r]/.test(field))
    )
      throw new Error(`Invalid argument: ${key}`)
  }
  if (value.action === 'commit') {
    const { messageMode, message, amend } = value.args
    if (messageMode === 'prepared') {
      if (message !== undefined || (amend !== undefined && amend !== false))
        throw new Error('Prepared merge message cannot be combined with message or amend')
    } else if (
      (messageMode !== undefined && messageMode !== 'message') ||
      (typeof message !== 'string' && !(message === undefined && amend === true))
    ) {
      throw new Error('Commit message is required')
    }
  }
  if (
    (value.action === 'cherryPick' || value.action === 'revert') &&
    value.args.mainline !== undefined &&
    !/^[1-9]\d*$/.test(String(value.args.mainline))
  )
    throw new Error('mainline must be a positive parent number')
  // All fields have been checked above; this is the JSON-to-domain boundary.
  return value as ActionRequest
}
