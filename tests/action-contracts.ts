import { api } from '../src/api'
import type { RepoActions } from '../src/hooks/useRepoActions'
import type { ActionRequest } from '../shared/actions'

// Compiled by typecheck, never executed. Invalid payloads must stay compile errors.
export function checkActionContracts(actions: RepoActions) {
  void api.action('.', 'deleteRemoteTag', { remote: 'origin', name: 'v1' })
  void actions.run('Merge', 'commit', { messageMode: 'prepared' })
  // @ts-expect-error required tag name is missing
  void api.action('.', 'deleteRemoteTag', { remote: 'origin' })
  // @ts-expect-error remote selection is a string, not consent
  void actions.run('Delete', 'deleteRemoteTag', { remote: true, name: 'v1' })
  // @ts-expect-error payload belongs to a different action
  void api.action('.', 'discard', { name: 'v1' })
  // @ts-expect-error unknown action name
  void actions.run('Invalid', 'unknown', {})
  // @ts-expect-error default merge message cannot be combined with amend
  void actions.run('Invalid', 'commit', { messageMode: 'prepared', amend: true })
  // @ts-expect-error discriminated request cannot pair reset with tag args
  const invalid: ActionRequest = { repo: '.', action: 'reset', args: { name: 'v1' } }
  return invalid
}
