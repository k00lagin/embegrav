import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeArg, git, gitOrNull, gitOutput, optionalString } from './git.ts'
import { getState, getUncommitted } from './repo.ts'
import type { ActionArgs, ActionName, UndoStep } from '../shared/actions.ts'

export interface ActionOutcome {
  output: string
  undo?: UndoStep
}

type Handlers = {
  [K in ActionName]: (repo: string, args: ActionArgs[K]) => Promise<string | ActionOutcome>
}

const ref = (v: unknown, label = 'ref') => assertSafeArg(v, label)

// --- undo support -----------------------------------------------------------

async function headHash(repo: string): Promise<string | null> {
  return (await gitOrNull(repo, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim() || null
}

async function currentBranch(repo: string): Promise<string | undefined> {
  return (await gitOrNull(repo, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim() || undefined
}

async function operationInProgress(repo: string): Promise<boolean> {
  const s = await getState(repo, null)
  return s.mergeInProgress || s.rebaseInProgress || s.cherryPickInProgress || s.revertInProgress
}

/** Commit the tracked uncommitted changes without touching the working tree (git stash create). */
async function snapshotTracked(repo: string): Promise<string | undefined> {
  try {
    return (await git(repo, ['stash', 'create', 'embegrav: before reset'])).trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Discard changes by stashing them, then drop the stash entry so the graph stays
 * clean. The stash commit stays in the object database, so it can be reapplied
 * by hash. Returns null (and changes nothing) when stashing is not possible —
 * callers then fall back to a plain discard without undo.
 */
async function stashAway(
  repo: string,
  paths: string[] | null,
  includeUntracked: boolean,
): Promise<string | null> {
  if (!(await headHash(repo)) || (await operationInProgress(repo))) return null
  const stashRef = async () =>
    (await gitOrNull(repo, ['rev-parse', '-q', '--verify', 'refs/stash']))?.trim() || null
  const before = await stashRef()
  const args = ['stash', 'push', '--quiet', '-m', 'embegrav: discarded changes']
  if (includeUntracked) args.push('--include-untracked')
  try {
    await git(repo, paths ? ['--literal-pathspecs', ...args, '--', ...paths] : args)
  } catch {
    return null
  }
  const after = await stashRef()
  if (!after || after === before) return null
  await git(repo, ['stash', 'drop', '--quiet'])
  return after
}

function discardOutcome(snapshot: string): ActionOutcome {
  return {
    output: `Snapshot ${snapshot.slice(0, 8)} (restore manually with: git stash apply ${snapshot.slice(0, 8)})`,
    undo: {
      label: 'Restore discarded changes',
      action: 'stashApply',
      args: { selector: snapshot, reinstateIndex: true },
    },
  }
}

async function applySnapshot(repo: string, snapshot: string): Promise<string> {
  const hash = ref(snapshot, 'snapshot')
  try {
    return await gitOutput(repo, ['stash', 'apply', '--index', hash])
  } catch {
    // The index part may no longer apply cleanly; restore the changes unstaged.
    return gitOutput(repo, ['stash', 'apply', hash])
  }
}

const actions: Handlers = {
  // --- remote -------------------------------------------------------------
  async fetch(repo, a) {
    const args = ['fetch']
    if (a.prune) args.push('--prune')
    if (a.pruneTags) args.push('--prune-tags')
    const remote = optionalString(a.remote)
    args.push(remote ? ref(remote, 'remote') : '--all')
    return gitOutput(repo, args)
  },
  async pull(repo, a) {
    const args = ['pull']
    if (a.rebase) args.push('--rebase')
    if (a.noFF) args.push('--no-ff')
    if (a.squash) args.push('--squash')
    const remote = optionalString(a.remote)
    const branch = optionalString(a.branch)
    if (remote) args.push(ref(remote, 'remote'))
    if (branch) args.push(ref(branch, 'branch'))
    return gitOutput(repo, args)
  },
  async push(repo, a) {
    const args = ['push']
    if (a.setUpstream) args.push('-u')
    if (a.force) args.push('--force-with-lease')
    if (a.forceUnsafe) args.push('--force')
    args.push(ref(a.remote, 'remote'), ref(a.branch, 'branch'))
    return gitOutput(repo, args)
  },
  async pushTag(repo, a) {
    return gitOutput(repo, ['push', ref(a.remote, 'remote'), `refs/tags/${ref(a.name, 'tag')}`])
  },
  async deleteRemoteBranch(repo, a) {
    return gitOutput(repo, ['push', ref(a.remote, 'remote'), '--delete', ref(a.name, 'branch')])
  },
  async deleteRemoteTag(repo, a) {
    return gitOutput(repo, [
      'push',
      ref(a.remote, 'remote'),
      '--delete',
      `refs/tags/${ref(a.name, 'tag')}`,
    ])
  },
  async addRemote(repo, a) {
    return gitOutput(repo, ['remote', 'add', ref(a.name, 'remote'), ref(a.url, 'url')])
  },
  async editRemote(repo, a) {
    const out: string[] = []
    const name = ref(a.name, 'remote')
    const newName = optionalString(a.newName)
    const url = optionalString(a.url)
    if (url) out.push(await gitOutput(repo, ['remote', 'set-url', name, ref(url, 'url')]))
    if (newName && newName !== name)
      out.push(await gitOutput(repo, ['remote', 'rename', name, ref(newName, 'remote')]))
    return out.join('\n')
  },
  async removeRemote(repo, a) {
    return gitOutput(repo, ['remote', 'remove', ref(a.name, 'remote')])
  },
  async pruneRemote(repo, a) {
    return gitOutput(repo, ['remote', 'prune', ref(a.name, 'remote')])
  },
  async setUpstream(repo, a) {
    return gitOutput(repo, [
      'branch',
      `--set-upstream-to=${ref(a.upstream, 'upstream')}`,
      ref(a.branch, 'branch'),
    ])
  },

  // --- branches -----------------------------------------------------------
  async checkoutBranch(repo, a) {
    return gitOutput(repo, ['checkout', ref(a.name, 'branch')])
  },
  async checkoutRemoteBranch(repo, a) {
    const remoteRef = ref(a.remoteRef, 'remote branch')
    const local = ref(a.localName, 'branch')
    return gitOutput(repo, ['checkout', '-b', local, '--track', remoteRef])
  },
  async checkoutCommit(repo, a) {
    return gitOutput(repo, ['checkout', '--detach', ref(a.hash, 'commit')])
  },
  async createBranch(repo, a) {
    const name = ref(a.name, 'branch')
    const hash = ref(a.hash, 'commit')
    if (a.checkout) return gitOutput(repo, ['checkout', '-b', name, hash])
    if (a.force) return gitOutput(repo, ['branch', '-f', name, hash])
    return gitOutput(repo, ['branch', name, hash])
  },
  async deleteBranch(repo, a) {
    const name = ref(a.name, 'branch')
    const [hash, upstream] = (
      await git(repo, [
        'for-each-ref',
        '--format=%(objectname)%00%(upstream:short)',
        `refs/heads/${name}`,
      ])
    )
      .trim()
      .split('\0')
    const output = await gitOutput(repo, ['branch', a.force ? '-D' : '-d', name])
    if (!hash) return output
    return {
      output,
      undo: {
        label: `Restore branch ${name}`,
        action: 'restoreBranch',
        args: upstream ? { name, hash, upstream } : { name, hash },
      },
    }
  },
  async restoreBranch(repo, a) {
    const name = ref(a.name, 'branch')
    const out = [await gitOutput(repo, ['branch', name, ref(a.hash, 'commit')])]
    const upstream = optionalString(a.upstream)
    if (upstream) {
      try {
        out.push(
          await gitOutput(repo, ['branch', `--set-upstream-to=${ref(upstream, 'upstream')}`, name]),
        )
      } catch (e) {
        out.push(`Upstream ${upstream} was not restored: ${(e as Error).message}`)
      }
    }
    return out.filter(Boolean).join('\n')
  },
  async renameBranch(repo, a) {
    return gitOutput(repo, ['branch', '-m', ref(a.name, 'branch'), ref(a.newName, 'new name')])
  },

  // --- history ------------------------------------------------------------
  async merge(repo, a) {
    const args = ['merge']
    if (a.noFF) args.push('--no-ff')
    if (a.squash) args.push('--squash')
    if (a.noCommit) args.push('--no-commit')
    args.push(ref(a.ref))
    return gitOutput(repo, args)
  },
  async rebase(repo, a) {
    const args = ['rebase']
    if (a.preserveMerges) args.push('--rebase-merges')
    if (a.ignoreDate) args.push('--ignore-date')
    args.push(ref(a.ref))
    const branch = optionalString(a.branch)
    if (branch) args.push(ref(branch, 'branch'))
    return gitOutput(repo, args)
  },
  async cherryPick(repo, a) {
    const args = ['cherry-pick']
    if (a.recordOrigin) args.push('-x')
    if (a.noCommit) args.push('--no-commit')
    const mainline = optionalString(a.mainline)
    if (mainline) args.push('-m', String(Number(mainline)))
    args.push(ref(a.hash, 'commit'))
    return gitOutput(repo, args)
  },
  async revert(repo, a) {
    const args = ['revert', '--no-edit']
    const mainline = optionalString(a.mainline)
    if (mainline) args.push('-m', String(Number(mainline)))
    args.push(ref(a.hash, 'commit'))
    return gitOutput(repo, args)
  },
  async reset(repo, a) {
    const mode = a.mode
    const hash = ref(a.hash, 'commit')
    const [before, branch] = await Promise.all([headHash(repo), currentBranch(repo)])
    const snapshot = mode === 'hard' ? await snapshotTracked(repo) : undefined
    const output = await gitOutput(repo, ['reset', `--${mode}`, hash])
    if (!before) return output
    return {
      output,
      undo: {
        label: `Undo reset to ${hash.slice(0, 8)}`,
        action: 'restoreHead',
        // After a hard reset the tracked files are clean, so --keep moves back
        // safely and still refuses to clobber anything edited in the meantime.
        args: { hash: before, mode: mode === 'hard' ? 'keep' : mode, branch, snapshot },
      },
    }
  },
  async restoreHead(repo, a) {
    const expected = optionalString(a.branch)
    const branch = await currentBranch(repo)
    if (expected !== branch)
      throw new Error(
        expected
          ? `Cannot undo: ${expected} is no longer the checked out branch`
          : 'Cannot undo: HEAD is no longer detached',
      )
    const out = [await gitOutput(repo, ['reset', `--${a.mode}`, ref(a.hash, 'commit')])]
    const snapshot = optionalString(a.snapshot)
    if (snapshot) out.push(await applySnapshot(repo, snapshot))
    return out.filter(Boolean).join('\n')
  },
  async dropCommit(repo, a) {
    const hash = ref(a.hash, 'commit')
    const [before, branch] = await Promise.all([headHash(repo), currentBranch(repo)])
    const output = await gitOutput(repo, ['rebase', '--onto', `${hash}^`, hash])
    if (!before) return output
    return {
      output,
      undo: {
        label: `Restore commit ${hash.slice(0, 8)}`,
        action: 'restoreHead',
        args: { hash: before, mode: 'keep', branch },
      },
    }
  },
  async abort(repo, a) {
    const op = a.op
    return gitOutput(repo, [op, '--abort'])
  },
  async continue(repo, a) {
    const op = a.op
    return gitOutput(repo, [op, '--continue'])
  },
  async skip(repo, a) {
    const op = a.op
    return gitOutput(repo, [op, '--skip'])
  },

  // --- tags ---------------------------------------------------------------
  async createTag(repo, a) {
    const name = ref(a.name, 'tag')
    const hash = ref(a.hash, 'commit')
    const message = optionalString(a.message)
    const args = ['tag']
    if (a.force) args.push('-f')
    if (a.annotated || message) args.push('-a', '-m', message ?? name)
    args.push(name, hash)
    return gitOutput(repo, args)
  },
  async deleteTag(repo, a) {
    return gitOutput(repo, ['tag', '-d', ref(a.name, 'tag')])
  },

  // --- stashes ------------------------------------------------------------
  async stashPush(repo, a) {
    const args = ['stash', 'push']
    if (a.includeUntracked) args.push('--include-untracked')
    if (a.keepIndex) args.push('--keep-index')
    const message = optionalString(a.message)
    if (message) args.push('-m', message)
    return gitOutput(repo, args)
  },
  async stashApply(repo, a) {
    const args = ['stash', 'apply']
    if (a.reinstateIndex) args.push('--index')
    args.push(ref(a.selector, 'stash'))
    return gitOutput(repo, args)
  },
  async stashPop(repo, a) {
    const args = ['stash', 'pop']
    if (a.reinstateIndex) args.push('--index')
    args.push(ref(a.selector, 'stash'))
    return gitOutput(repo, args)
  },
  async stashDrop(repo, a) {
    return gitOutput(repo, ['stash', 'drop', ref(a.selector, 'stash')])
  },
  async stashBranch(repo, a) {
    return gitOutput(repo, ['stash', 'branch', ref(a.name, 'branch'), ref(a.selector, 'stash')])
  },

  // --- working tree -------------------------------------------------------
  async stage(repo, a) {
    return gitOutput(repo, ['--literal-pathspecs', 'add', '-A', '--', ...a.paths])
  },
  async stageAll(repo) {
    return gitOutput(repo, ['add', '-A'])
  },
  async unstage(repo, a) {
    return gitOutput(repo, ['--literal-pathspecs', 'reset', '-q', '--', ...a.paths])
  },
  async unstageAll(repo) {
    return gitOutput(repo, ['reset', '-q'])
  },
  async discard(repo, a) {
    const paths = a.paths
    const snapshot = await stashAway(repo, paths, true)
    if (snapshot) return discardOutcome(snapshot)
    const out: string[] = []
    // Untracked files: remove from disk. Tracked: restore from HEAD (or drop from index if new).
    const entries = await getUncommitted(repo, paths)
    const untracked: string[] = []
    const added: string[] = []
    const tracked: string[] = []
    for (const entry of entries) {
      if (entry.untracked) untracked.push(entry.path)
      else if (entry.index === 'A') added.push(entry.path)
      else tracked.push(entry.path)
    }
    if (untracked.length)
      out.push(await gitOutput(repo, ['--literal-pathspecs', 'clean', '-f', '--', ...untracked]))
    if (added.length) {
      out.push(
        await gitOutput(repo, [
          '--literal-pathspecs',
          'rm',
          '-q',
          '--cached',
          '-f',
          '--',
          ...added,
        ]),
      )
      for (const p of added) await rm(join(repo, p), { force: true })
    }
    if (tracked.length) {
      out.push(await gitOutput(repo, ['--literal-pathspecs', 'checkout', 'HEAD', '--', ...tracked]))
    }
    return out.filter(Boolean).join('\n')
  },
  async discardAll(repo, a) {
    // Same effect as reset --hard (and clean -fd), but recoverable.
    const snapshot = await stashAway(repo, null, !!a.includeUntracked)
    if (snapshot) return discardOutcome(snapshot)
    const out = [await gitOutput(repo, ['reset', '--hard'])]
    if (a.includeUntracked) out.push(await gitOutput(repo, ['clean', '-fd']))
    return out.join('\n')
  },
  async commit(repo, a) {
    if (a.messageMode === 'prepared') {
      const merge = await git(repo, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
        allowCodes: [1],
      })
      if (!merge.trim()) throw new Error('No merge is in progress')
      const args = ['commit', '--no-edit']
      if (a.signoff) args.push('--signoff')
      if (a.allowEmpty) args.push('--allow-empty')
      return gitOutput(repo, args)
    }
    const message = a.message?.trim() ?? ''
    const amend = a.amend
    if (!message && !amend) throw new Error('Commit message is required')
    const args = ['commit', '--file=-']
    if (amend) args.push('--amend')
    if (a.signoff) args.push('--signoff')
    if (a.allowEmpty) args.push('--allow-empty')
    if (amend && !message) {
      args.splice(1, 1, '--no-edit')
      return gitOutput(repo, args)
    }
    return gitOutput(repo, args, { input: message + '\n' })
  },
  async resolveConflict(repo, a) {
    const paths = a.paths
    const side = a.side
    await gitOutput(repo, ['--literal-pathspecs', 'checkout', `--${side}`, '--', ...paths])
    return gitOutput(repo, ['--literal-pathspecs', 'add', '--', ...paths])
  },
  async setUser(repo, a) {
    const out: string[] = []
    const name = optionalString(a.name)
    const email = optionalString(a.email)
    if (name) out.push(await gitOutput(repo, ['config', 'user.name', name]))
    if (email) out.push(await gitOutput(repo, ['config', 'user.email', email]))
    return out.join('\n')
  },
}

export async function runAction<K extends ActionName>(
  repo: string,
  action: K,
  args: ActionArgs[K],
): Promise<ActionOutcome> {
  const result = await actions[action](repo, args)
  return typeof result === 'string' ? { output: result } : result
}
