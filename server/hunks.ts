import type { ActionArgs } from '../shared/actions.ts'
import { splitPatchHunks } from '../shared/patch.ts'
import { getFileDiff, getUncommitted } from './repo.ts'
import { gitOutput } from './git.ts'

/** Apply one freshly verified hunk to the index; never write to the working tree. */
export async function applyHunk(repo: string, args: ActionArgs['stageHunk'], reverse: boolean) {
  const file = (await getUncommitted(repo, [args.path])).find((item) => item.path === args.path)
  if (!file || file.conflicted)
    throw new Error('This file changed or has unresolved conflicts. Reload the diff.')
  const current = await getFileDiff({
    repo,
    path: args.path,
    from: reverse ? 'HEAD' : 'INDEX',
    to: reverse ? 'INDEX' : 'WORKING',
    untracked: !reverse && file.untracked,
  })
  if (current.patch !== args.patch)
    throw new Error('The diff has changed. Reload it before staging or unstaging a hunk.')
  const hunk = splitPatchHunks(current.patch)[args.hunk]
  if (current.binary || !Number.isSafeInteger(args.hunk) || args.hunk < 0 || !hunk)
    throw new Error(
      'This change cannot be staged or unstaged as a hunk. Use the whole-file action.',
    )
  return gitOutput(
    repo,
    ['apply', '--cached', '--whitespace=nowarn', ...(reverse ? ['--reverse'] : []), '-'],
    {
      input: hunk.patch,
    },
  )
}
