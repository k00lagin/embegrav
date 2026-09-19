import { useMemo } from 'react'
import type { ActionArgs, ActionName } from '@shared/actions'
import { checkedValue, choiceValue, optionalTextValue, textValue } from '@/components/dialogValues'
import type { GitCommit, GitRef, GraphData, StashInfo } from '@shared/types'
import { api } from '@/api'
import { useDialog } from '@/components/Dialog'
import { useToast } from '@/components/Toast'
import type { MenuEntry } from '@/components/ContextMenu'
import type { LabelTarget } from '@/components/RefLabel'
import { shortHash } from '@/lib/format'
import type { Settings } from '@/lib/settings'
import IconGitBranchPlus from '~icons/lucide/git-branch-plus'
import IconCheck from '~icons/lucide/check'
import IconCherry from '~icons/lucide/cherry'
import IconRotateCcw from '~icons/lucide/rotate-ccw'
import IconGitMerge from '~icons/lucide/git-merge'
import IconGitPullRequest from '~icons/lucide/git-pull-request'
import IconUndo2 from '~icons/lucide/undo-2'
import IconTrash2 from '~icons/lucide/trash-2'
import IconTag from '~icons/lucide/tag'
import IconCopy from '~icons/lucide/copy'
import IconPencil from '~icons/lucide/pencil'
import IconUpload from '~icons/lucide/upload'
import IconDownload from '~icons/lucide/download'
import IconArchive from '~icons/lucide/archive'
import IconArchiveRestore from '~icons/lucide/archive-restore'
import IconEraser from '~icons/lucide/eraser'
import IconPlus from '~icons/lucide/plus'
import IconMinus from '~icons/lucide/minus'
import IconLink from '~icons/lucide/link'
import IconCloudDownload from '~icons/lucide/cloud-download'

export interface RunOptions {
  /** Message shown on success (defaults to the title) */
  successMessage?: string
  /** Do not show a toast on success */
  silent?: boolean
}

export interface RepoActions {
  run: <K extends ActionName>(
    title: string,
    action: K,
    args: ActionArgs[K],
    opts?: RunOptions,
  ) => Promise<boolean>
  commitMenu: (commit: GitCommit, extra?: MenuEntry[]) => MenuEntry[]
  refMenu: (target: LabelTarget, commit: GitCommit) => MenuEntry[]
  stashMenu: (stash: StashInfo) => MenuEntry[]
  uncommittedMenu: () => MenuEntry[]
  fetchAll: () => Promise<boolean>
  pull: () => Promise<boolean>
  push: () => Promise<boolean>
  stash: () => Promise<boolean>
  discardAll: () => Promise<boolean>
  createBranchAt: (hash: string) => Promise<boolean>
  editUser: () => Promise<void>
  copy: (text: string, what: string) => Promise<void>
}

// oxlint-disable-next-line no-control-regex -- git forbids control characters in ref names
const BRANCH_NAME_RE = /^(?!\/|.*(?:[/.]\.|\/\/|@\{|\\))[^\x00-\x1f\x7f ~^:?*[]+(?<!\.lock|[/.])$/

function validateRefName(name: string, label = 'Branch name'): string | null {
  if (!name.trim()) return `${label} is required`
  if (!BRANCH_NAME_RE.test(name)) return `"${name}" is not a valid ${label.toLowerCase()}`
  return null
}

export function useRepoActions(
  repo: string | null,
  data: GraphData | null,
  refresh: () => void,
  settings: Settings,
): RepoActions {
  const dialog = useDialog()
  const toast = useToast()

  return useMemo<RepoActions>(() => {
    const run: RepoActions['run'] = async (title, action, args, opts = {}) => {
      if (!repo) return false
      const id = toast.show('progress', `${title}…`)
      try {
        const r = await api.action(repo, action, args)
        if (opts.silent) toast.dismiss(id)
        else
          toast.update(
            id,
            { kind: 'success', title: opts.successMessage ?? title, detail: r.output || undefined },
            4000,
          )
        refresh()
        return true
      } catch (e) {
        toast.update(id, { kind: 'error', title: `${title} failed`, detail: (e as Error).message })
        refresh()
        return false
      }
    }

    const copy = async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text)
        toast.show('success', `${what} copied to clipboard`, undefined, 2000)
      } catch {
        toast.show('error', `Could not copy ${what.toLowerCase()}`)
      }
    }

    const remotes = data?.remotes ?? []
    const current = data?.currentBranch ?? null
    const localBranches = (data?.refs ?? []).filter((r) => r.type === 'head').map((r) => r.name)
    const busy =
      !!data &&
      (data.state.mergeInProgress ||
        data.state.rebaseInProgress ||
        data.state.cherryPickInProgress ||
        data.state.revertInProgress)

    const remoteField = (name = 'remote', label = 'Remote') =>
      ({
        type: 'select',
        name,
        label,
        options: remotes.map((r) => ({ value: r.name, label: `${r.name}  (${r.url})` })),
        default: remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name,
      }) as const

    const trackingDefaults = (branch: string | null) => {
      const configured = data?.refs.find((r) => r.type === 'head' && r.name === branch)?.remote
      const remote = configured ?? remoteField().default
      const upstream = branch === current ? data?.upstream?.name : undefined
      return {
        remote,
        branch:
          remote && upstream?.startsWith(`${remote}/`)
            ? upstream.slice(remote.length + 1)
            : (branch ?? ''),
        hasUpstream: !!configured,
      }
    }

    // ----- shared flows ----------------------------------------------------

    const createBranchAt = async (hash: string) => {
      const v = await dialog.open({
        title: 'Create Branch',
        description: `From commit ${shortHash(hash)}`,
        fields: [
          { type: 'text', name: 'name', label: 'Branch name', placeholder: 'feature/my-branch' },
          { type: 'checkbox', name: 'checkout', label: 'Check out after creating', default: true },
        ],
        submitLabel: 'Create Branch',
        validate: (val) => validateRefName(String(val.name)),
      })
      if (!v) return false
      return run(`Create branch ${textValue(v, 'name')}`, 'createBranch', {
        name: textValue(v, 'name'),
        hash,
        checkout: checkedValue(v, 'checkout'),
      })
    }

    const createTagAt = async (hash: string) => {
      const v = await dialog.open({
        title: 'Create Tag',
        description: `On commit ${shortHash(hash)}`,
        fields: [
          { type: 'text', name: 'name', label: 'Tag name', placeholder: 'v1.0.0' },
          {
            type: 'radio',
            name: 'kind',
            label: 'Type',
            options: [
              { value: 'annotated', label: 'Annotated' },
              { value: 'lightweight', label: 'Lightweight' },
            ],
            default: 'annotated',
          },
          { type: 'textarea', name: 'message', label: 'Message (annotated tags)', rows: 3 },
          ...(remotes.length
            ? [
                {
                  type: 'checkbox',
                  name: 'push',
                  label: 'Push tag to remote after creating',
                  default: false,
                } as const,
              ]
            : []),
        ],
        submitLabel: 'Create Tag',
        validate: (val) => validateRefName(String(val.name), 'Tag name'),
      })
      if (!v) return false
      const ok = await run(`Create tag ${textValue(v, 'name')}`, 'createTag', {
        name: textValue(v, 'name'),
        hash,
        annotated: textValue(v, 'kind') === 'annotated',
        message:
          textValue(v, 'kind') === 'annotated'
            ? String(textValue(v, 'message') || textValue(v, 'name'))
            : undefined,
      })
      if (ok && checkedValue(v, 'push')) {
        const remote = remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name
        if (remote)
          await run(`Push tag ${textValue(v, 'name')} to ${remote}`, 'pushTag', {
            remote,
            name: textValue(v, 'name'),
          })
      }
      return ok
    }

    const mergeInto = async (ref: string) => {
      const v = await dialog.open({
        title: `Merge into ${current ?? 'current branch'}`,
        description: `Merge "${ref}" into the current branch.`,
        fields: [
          {
            type: 'checkbox',
            name: 'noFF',
            label: 'Create a new commit even if fast-forward is possible (--no-ff)',
            default: false,
          },
          { type: 'checkbox', name: 'squash', label: 'Squash commits (--squash)', default: false },
          {
            type: 'checkbox',
            name: 'noCommit',
            label: 'Do not commit automatically (--no-commit)',
            default: false,
          },
        ],
        submitLabel: 'Merge',
      })
      if (!v) return false
      return run(`Merge ${ref}`, 'merge', {
        ref,
        noFF: checkedValue(v, 'noFF'),
        squash: checkedValue(v, 'squash'),
        noCommit: checkedValue(v, 'noCommit'),
      })
    }

    const rebaseOnto = async (ref: string) => {
      const v = await dialog.open({
        title: `Rebase ${current ?? 'current branch'}`,
        description: `Rebase the current branch on "${ref}".`,
        fields: [
          {
            type: 'checkbox',
            name: 'preserveMerges',
            label: 'Preserve merge commits (--rebase-merges)',
            default: false,
          },
        ],
        submitLabel: 'Rebase',
      })
      if (!v) return false
      return run(`Rebase on ${ref}`, 'rebase', {
        ref,
        preserveMerges: checkedValue(v, 'preserveMerges'),
      })
    }

    const resetTo = async (hash: string) => {
      const v = await dialog.open({
        title: `Reset ${current ?? 'HEAD'} to ${shortHash(hash)}`,
        fields: [
          {
            type: 'radio',
            name: 'mode',
            label: 'Reset mode',
            options: [
              { value: 'soft', label: 'Soft', description: 'Keep all changes staged' },
              {
                value: 'mixed',
                label: 'Mixed',
                description: 'Keep changes in the working tree, unstaged',
              },
              { value: 'hard', label: 'Hard', description: 'Discard all changes' },
            ],
            default: 'mixed',
          },
        ],
        submitLabel: 'Reset',
        danger: true,
      })
      if (!v) return false
      return run(
        `Reset (${choiceValue(v, 'mode', ['soft', 'mixed', 'hard'])}) to ${shortHash(hash)}`,
        'reset',
        { hash, mode: choiceValue(v, 'mode', ['soft', 'mixed', 'hard']) },
      )
    }

    const pushBranch = async (branch: string) => {
      if (remotes.length === 0) {
        toast.show('error', 'No remotes configured', 'Add a remote first (Toolbar → Remotes).')
        return false
      }
      const defaults = trackingDefaults(branch)
      const v = await dialog.open({
        title: `Push ${branch}`,
        fields: [
          { ...remoteField(), default: defaults.remote },
          {
            type: 'checkbox',
            name: 'setUpstream',
            label: 'Set upstream (-u)',
            default: !defaults.hasUpstream,
          },
          {
            type: 'checkbox',
            name: 'force',
            label: 'Force push (--force-with-lease)',
            default: false,
          },
        ],
        submitLabel: 'Push',
      })
      if (!v) return false
      return run(`Push ${branch} to ${textValue(v, 'remote')}`, 'push', {
        remote: textValue(v, 'remote'),
        branch,
        setUpstream: checkedValue(v, 'setUpstream'),
        force: checkedValue(v, 'force'),
      })
    }

    const pull = async () => {
      if (remotes.length === 0) {
        toast.show('error', 'No remotes configured')
        return false
      }
      const up = data?.upstream?.name
      const defaults = trackingDefaults(current)
      const v = await dialog.open({
        title: `Pull into ${current ?? 'current branch'}`,
        description: up ? `Upstream: ${up}` : 'No upstream is configured for the current branch.',
        fields: [
          { ...remoteField(), default: defaults.remote },
          {
            type: 'text',
            name: 'branch',
            label: 'Remote branch',
            default: defaults.branch,
          },
          {
            type: 'checkbox',
            name: 'rebase',
            label: 'Rebase instead of merge (--rebase)',
            default: false,
          },
        ],
        submitLabel: 'Pull',
      })
      if (!v) return false
      return run(`Pull ${textValue(v, 'remote')}/${textValue(v, 'branch')}`, 'pull', {
        remote: textValue(v, 'remote'),
        branch: textValue(v, 'branch'),
        rebase: checkedValue(v, 'rebase'),
      })
    }

    const fetchAll = async () => {
      if (remotes.length === 0) {
        toast.show('error', 'No remotes configured')
        return false
      }
      return run('Fetch from all remotes', 'fetch', { prune: settings.fetchAndPrune })
    }

    const stash = async () => {
      const v = await dialog.open({
        title: 'Stash Changes',
        fields: [
          { type: 'text', name: 'message', label: 'Message (optional)' },
          {
            type: 'checkbox',
            name: 'includeUntracked',
            label: 'Include untracked files',
            default: true,
          },
          {
            type: 'checkbox',
            name: 'keepIndex',
            label: 'Keep staged changes in the index (--keep-index)',
            default: false,
          },
        ],
        submitLabel: 'Stash',
      })
      if (!v) return false
      return run('Stash changes', 'stashPush', {
        message: textValue(v, 'message'),
        includeUntracked: checkedValue(v, 'includeUntracked'),
        keepIndex: checkedValue(v, 'keepIndex'),
      })
    }

    const editUser = async () => {
      const v = await dialog.open({
        title: 'Repository User',
        fields: [
          { type: 'text', name: 'name', label: 'Name', default: data?.userName ?? '' },
          { type: 'text', name: 'email', label: 'Email', default: data?.userEmail ?? '' },
        ],
        submitLabel: 'Save',
      })
      if (!v) return
      await run('Update user', 'setUser', {
        name: textValue(v, 'name'),
        email: textValue(v, 'email'),
      })
    }

    // ----- menus -----------------------------------------------------------

    const commitMenu: RepoActions['commitMenu'] = (commit, extra = []) => {
      const h = commit.hash
      const isHead = data?.head === h
      const isMerge = commit.parents.length > 1
      const mainlineField = isMerge
        ? [
            {
              type: 'select',
              name: 'mainline',
              label: 'Mainline parent (merge commit)',
              options: commit.parents.map((p, i) => ({
                value: String(i + 1),
                label: `${i + 1}: ${shortHash(p)}`,
              })),
              default: '1',
            } as const,
          ]
        : []
      return [
        {
          label: 'Create Branch…',
          icon: <IconGitBranchPlus />,
          onClick: () => void createBranchAt(h),
        },
        {
          label: 'Checkout (detached HEAD)',
          icon: <IconCheck />,
          disabled: isHead,
          onClick: () => void run(`Checkout ${shortHash(h)}`, 'checkoutCommit', { hash: h }),
        },
        'separator',
        {
          label: 'Cherry Pick…',
          icon: <IconCherry />,
          disabled: busy,
          onClick: async () => {
            const v = await dialog.open({
              title: `Cherry pick ${shortHash(h)}`,
              description: commit.subject,
              fields: [
                ...mainlineField,
                {
                  type: 'checkbox',
                  name: 'recordOrigin',
                  label: 'Record origin commit in message (-x)',
                  default: false,
                },
                {
                  type: 'checkbox',
                  name: 'noCommit',
                  label: 'Do not commit automatically (--no-commit)',
                  default: false,
                },
              ],
              submitLabel: 'Cherry Pick',
            })
            if (v)
              await run(`Cherry pick ${shortHash(h)}`, 'cherryPick', {
                hash: h,
                mainline: optionalTextValue(v, 'mainline'),
                recordOrigin: checkedValue(v, 'recordOrigin'),
                noCommit: checkedValue(v, 'noCommit'),
              })
          },
        },
        {
          label: 'Revert…',
          icon: <IconRotateCcw />,
          disabled: busy,
          onClick: async () => {
            const v = await dialog.open({
              title: `Revert ${shortHash(h)}`,
              description: `Create a new commit that reverts "${commit.subject}".`,
              fields: mainlineField,
              submitLabel: 'Revert',
            })
            if (v)
              await run(`Revert ${shortHash(h)}`, 'revert', {
                hash: h,
                mainline: optionalTextValue(v, 'mainline'),
              })
          },
        },
        {
          label: 'Drop Commit…',
          icon: <IconTrash2 />,
          disabled: busy || isMerge || commit.parents.length === 0,
          danger: true,
          onClick: async () => {
            const ok = await dialog.confirm(
              `Drop commit ${shortHash(h)}?`,
              `"${commit.subject}" will be removed from the current branch by rebasing the commits after it. Only use this on commits that are on the current branch and not pushed yet.`,
              { submitLabel: 'Drop Commit', danger: true },
            )
            if (ok) await run(`Drop commit ${shortHash(h)}`, 'dropCommit', { hash: h })
          },
        },
        'separator',
        {
          label: `Merge into ${current ?? 'current branch'}…`,
          icon: <IconGitMerge />,
          disabled: isHead || busy || !current,
          onClick: () => void mergeInto(h),
        },
        {
          label: `Rebase ${current ?? 'current branch'} on this Commit…`,
          icon: <IconGitPullRequest />,
          disabled: isHead || busy || !current,
          onClick: () => void rebaseOnto(h),
        },
        {
          label: `Reset ${current ?? 'HEAD'} to this Commit…`,
          icon: <IconUndo2 />,
          disabled: busy,
          danger: true,
          onClick: () => void resetTo(h),
        },
        'separator',
        { label: 'Create Tag…', icon: <IconTag />, onClick: () => void createTagAt(h) },
        'separator',
        ...extra,
        {
          label: 'Copy Commit Hash',
          icon: <IconCopy />,
          onClick: () => void copy(h, 'Commit hash'),
          hint: shortHash(h),
        },
        {
          label: 'Copy Commit Subject',
          icon: <IconCopy />,
          onClick: () => void copy(commit.subject, 'Commit subject'),
        },
      ]
    }

    const localBranchMenu = (ref: GitRef, commit: GitCommit): MenuEntry[] => {
      const name = ref.name
      const isCurrent = name === current
      const items: MenuEntry[] = []
      if (!isCurrent) {
        items.push({
          label: `Checkout ${name}`,
          icon: <IconCheck />,
          disabled: busy,
          onClick: () => void run(`Checkout ${name}`, 'checkoutBranch', { name }),
        })
      }
      items.push(
        {
          label: 'Rename Branch…',
          icon: <IconPencil />,
          onClick: async () => {
            const v = await dialog.open({
              title: `Rename ${name}`,
              fields: [{ type: 'text', name: 'newName', label: 'New name', default: name }],
              submitLabel: 'Rename',
              validate: (val) => validateRefName(String(val.newName)),
            })
            if (v && textValue(v, 'newName') !== name)
              await run(`Rename ${name} → ${textValue(v, 'newName')}`, 'renameBranch', {
                name,
                newName: textValue(v, 'newName'),
              })
          },
        },
        {
          label: 'Delete Branch…',
          icon: <IconTrash2 />,
          danger: true,
          disabled: isCurrent,
          onClick: async () => {
            const remoteCounterpart = data?.refs.find(
              (r) => r.type === 'remote' && r.name.endsWith(`/${name}`),
            )
            const v = await dialog.open({
              title: `Delete branch ${name}?`,
              fields: [
                {
                  type: 'checkbox',
                  name: 'force',
                  label: 'Force delete (even if not fully merged)',
                  default: false,
                },
                ...(remoteCounterpart
                  ? [
                      {
                        type: 'checkbox',
                        name: 'deleteRemote',
                        label: `Also delete ${remoteCounterpart.name} on the remote`,
                        default: false,
                      } as const,
                    ]
                  : []),
              ],
              submitLabel: 'Delete',
              danger: true,
            })
            if (!v) return
            const ok = await run(`Delete ${name}`, 'deleteBranch', {
              name,
              force: checkedValue(v, 'force'),
            })
            if (ok && checkedValue(v, 'deleteRemote') && remoteCounterpart?.remote) {
              await run(`Delete ${remoteCounterpart.name}`, 'deleteRemoteBranch', {
                remote: remoteCounterpart.remote,
                name,
              })
            }
          },
        },
        'separator',
      )
      if (!isCurrent && current) {
        items.push(
          {
            label: `Merge into ${current}…`,
            icon: <IconGitMerge />,
            disabled: busy,
            onClick: () => void mergeInto(name),
          },
          {
            label: `Rebase ${current} on ${name}…`,
            icon: <IconGitPullRequest />,
            disabled: busy,
            onClick: () => void rebaseOnto(name),
          },
          'separator',
        )
      }
      items.push(
        {
          label: 'Push Branch…',
          icon: <IconUpload />,
          disabled: remotes.length === 0,
          onClick: () => void pushBranch(name),
        },
        ...(isCurrent
          ? [
              {
                label: 'Pull…',
                icon: <IconDownload />,
                disabled: remotes.length === 0 || busy,
                onClick: () => void pull(),
              },
            ]
          : []),
        {
          label: 'Set Upstream…',
          icon: <IconLink />,
          disabled: (data?.refs.filter((r) => r.type === 'remote').length ?? 0) === 0,
          onClick: async () => {
            const remoteRefs = (data?.refs ?? []).filter((r) => r.type === 'remote')
            const v = await dialog.open({
              title: `Set upstream for ${name}`,
              fields: [
                {
                  type: 'select',
                  name: 'upstream',
                  label: 'Upstream branch',
                  options: remoteRefs.map((r) => ({ value: r.name, label: r.name })),
                  default:
                    remoteRefs.find((r) => r.name.endsWith(`/${name}`))?.name ??
                    remoteRefs[0]?.name,
                },
              ],
              submitLabel: 'Set Upstream',
            })
            if (v)
              await run(`Set upstream of ${name} to ${textValue(v, 'upstream')}`, 'setUpstream', {
                branch: name,
                upstream: textValue(v, 'upstream'),
              })
          },
        },
        'separator',
        {
          label: 'Copy Branch Name',
          icon: <IconCopy />,
          onClick: () => void copy(name, 'Branch name'),
        },
        {
          label: 'Copy Commit Hash',
          icon: <IconCopy />,
          onClick: () => void copy(commit.hash, 'Commit hash'),
          hint: shortHash(commit.hash),
        },
      )
      return items
    }

    const remoteBranchMenu = (ref: GitRef, commit: GitCommit): MenuEntry[] => {
      const remote = ref.remote ?? ref.name.split('/')[0]
      const branch = ref.name.slice(remote.length + 1)
      const localExists = localBranches.includes(branch)
      return [
        {
          label: localExists ? `Checkout ${branch}` : `Checkout ${ref.name} (create local branch)`,
          icon: <IconCheck />,
          disabled: busy || branch === current,
          onClick: async () => {
            if (localExists) {
              await run(`Checkout ${branch}`, 'checkoutBranch', { name: branch })
              return
            }
            const v = await dialog.open({
              title: `Checkout ${ref.name}`,
              fields: [
                { type: 'text', name: 'localName', label: 'Local branch name', default: branch },
              ],
              submitLabel: 'Checkout',
              validate: (val) => validateRefName(String(val.localName)),
            })
            if (v)
              await run(`Checkout ${ref.name}`, 'checkoutRemoteBranch', {
                remoteRef: ref.name,
                localName: textValue(v, 'localName'),
              })
          },
        },
        {
          label: 'Delete Remote Branch…',
          icon: <IconTrash2 />,
          danger: true,
          onClick: async () => {
            const ok = await dialog.confirm(
              `Delete ${ref.name}?`,
              `The branch "${branch}" will be deleted on remote "${remote}".`,
              { submitLabel: 'Delete', danger: true },
            )
            if (ok) await run(`Delete ${ref.name}`, 'deleteRemoteBranch', { remote, name: branch })
          },
        },
        'separator',
        ...(current
          ? [
              {
                label: `Merge into ${current}…`,
                icon: <IconGitMerge />,
                disabled: busy,
                onClick: () => void mergeInto(ref.name),
              },
              {
                label: `Rebase ${current} on ${ref.name}…`,
                icon: <IconGitPullRequest />,
                disabled: busy,
                onClick: () => void rebaseOnto(ref.name),
              },
              {
                label: `Pull into ${current}…`,
                icon: <IconDownload />,
                disabled: busy,
                onClick: async () => {
                  const v = await dialog.open({
                    title: `Pull ${ref.name} into ${current}`,
                    fields: [
                      {
                        type: 'checkbox',
                        name: 'rebase',
                        label: 'Rebase instead of merge (--rebase)',
                        default: false,
                      },
                    ],
                    submitLabel: 'Pull',
                  })
                  if (v)
                    await run(`Pull ${ref.name}`, 'pull', {
                      remote,
                      branch,
                      rebase: checkedValue(v, 'rebase'),
                    })
                },
              },
              'separator' as const,
            ]
          : []),
        {
          label: `Fetch ${remote}`,
          icon: <IconCloudDownload />,
          onClick: () =>
            void run(`Fetch ${remote}`, 'fetch', { remote, prune: settings.fetchAndPrune }),
        },
        'separator',
        {
          label: 'Copy Branch Name',
          icon: <IconCopy />,
          onClick: () => void copy(ref.name, 'Branch name'),
        },
        {
          label: 'Copy Commit Hash',
          icon: <IconCopy />,
          onClick: () => void copy(commit.hash, 'Commit hash'),
          hint: shortHash(commit.hash),
        },
      ]
    }

    const tagMenu = (ref: GitRef, commit: GitCommit): MenuEntry[] => [
      {
        label: 'Checkout Tag (detached HEAD)',
        icon: <IconCheck />,
        disabled: busy,
        onClick: () =>
          void run(`Checkout ${ref.name}`, 'checkoutCommit', { hash: `refs/tags/${ref.name}` }),
      },
      {
        label: 'Push Tag…',
        icon: <IconUpload />,
        disabled: remotes.length === 0,
        onClick: async () => {
          const v = await dialog.open({
            title: `Push tag ${ref.name}`,
            fields: [remoteField()],
            submitLabel: 'Push',
          })
          if (v)
            await run(`Push tag ${ref.name} to ${textValue(v, 'remote')}`, 'pushTag', {
              remote: textValue(v, 'remote'),
              name: ref.name,
            })
        },
      },
      {
        label: 'Delete Tag…',
        icon: <IconTrash2 />,
        danger: true,
        onClick: async () => {
          const v = await dialog.open({
            title: `Delete tag ${ref.name}?`,
            fields: remotes.length
              ? [
                  {
                    type: 'checkbox',
                    name: 'deleteRemote',
                    label: 'Also delete the tag on a remote',
                    default: false,
                  },
                  remoteField(),
                ]
              : [],
            submitLabel: 'Delete',
            danger: true,
          })
          if (!v) return
          const ok = await run(`Delete tag ${ref.name}`, 'deleteTag', { name: ref.name })
          if (ok && checkedValue(v, 'deleteRemote'))
            await run(`Delete tag ${ref.name} on ${textValue(v, 'remote')}`, 'deleteRemoteTag', {
              remote: textValue(v, 'remote'),
              name: ref.name,
            })
        },
      },
      'separator',
      {
        label: 'Copy Tag Name',
        icon: <IconCopy />,
        onClick: () => void copy(ref.name, 'Tag name'),
      },
      {
        label: 'Copy Commit Hash',
        icon: <IconCopy />,
        onClick: () => void copy(commit.hash, 'Commit hash'),
        hint: shortHash(commit.hash),
      },
    ]

    const stashMenu: RepoActions['stashMenu'] = (s) => [
      {
        label: 'Apply Stash',
        icon: <IconArchiveRestore />,
        disabled: busy,
        onClick: () => void run(`Apply ${s.selector}`, 'stashApply', { selector: s.selector }),
      },
      {
        label: 'Apply Stash (reinstate index)',
        icon: <IconArchiveRestore />,
        disabled: busy,
        onClick: () =>
          void run(`Apply ${s.selector}`, 'stashApply', {
            selector: s.selector,
            reinstateIndex: true,
          }),
      },
      {
        label: 'Pop Stash',
        icon: <IconArchive />,
        disabled: busy,
        onClick: () => void run(`Pop ${s.selector}`, 'stashPop', { selector: s.selector }),
      },
      {
        label: 'Create Branch from Stash…',
        icon: <IconGitBranchPlus />,
        disabled: busy,
        onClick: async () => {
          const v = await dialog.open({
            title: `Branch from ${s.selector}`,
            fields: [{ type: 'text', name: 'name', label: 'Branch name' }],
            submitLabel: 'Create Branch',
            validate: (val) => validateRefName(String(val.name)),
          })
          if (v)
            await run(`Create branch ${textValue(v, 'name')} from ${s.selector}`, 'stashBranch', {
              name: textValue(v, 'name'),
              selector: s.selector,
            })
        },
      },
      'separator',
      {
        label: 'Drop Stash…',
        icon: <IconTrash2 />,
        danger: true,
        onClick: async () => {
          const ok = await dialog.confirm(`Drop ${s.selector}?`, s.message, {
            submitLabel: 'Drop',
            danger: true,
          })
          if (ok) await run(`Drop ${s.selector}`, 'stashDrop', { selector: s.selector })
        },
      },
      'separator',
      {
        label: 'Copy Stash Name',
        icon: <IconCopy />,
        onClick: () => void copy(s.selector, 'Stash name'),
      },
      {
        label: 'Copy Commit Hash',
        icon: <IconCopy />,
        onClick: () => void copy(s.hash, 'Commit hash'),
        hint: shortHash(s.hash),
      },
    ]

    const discardAll = async () => {
      const v = await dialog.open({
        title: 'Discard all changes?',
        description:
          'All staged and unstaged changes to tracked files will be permanently lost (git reset --hard).',
        fields: [
          {
            type: 'checkbox',
            name: 'includeUntracked',
            label: 'Also delete untracked files and directories (git clean -fd)',
            default: false,
          },
        ],
        submitLabel: 'Discard All',
        danger: true,
      })
      if (!v) return false
      return run('Discard all changes', 'discardAll', {
        includeUntracked: checkedValue(v, 'includeUntracked'),
      })
    }

    const uncommittedMenu: RepoActions['uncommittedMenu'] = () => [
      { label: 'Stash Changes…', icon: <IconArchive />, onClick: () => void stash() },
      {
        label: 'Stage All Changes',
        icon: <IconPlus />,
        onClick: () => void run('Stage all', 'stageAll', {}),
      },
      {
        label: 'Unstage All Changes',
        icon: <IconMinus />,
        onClick: () => void run('Unstage all', 'unstageAll', {}),
      },
      'separator',
      {
        label: 'Discard All Changes…',
        icon: <IconEraser />,
        danger: true,
        onClick: () => void discardAll(),
      },
    ]

    const refMenu: RepoActions['refMenu'] = (target, commit) => {
      if (target.kind === 'stash') return stashMenu(target.stash)
      if (target.kind === 'head') return commitMenu(commit)
      const ref = target.ref
      if (ref.type === 'head') return localBranchMenu(ref, commit)
      if (ref.type === 'remote') return remoteBranchMenu(ref, commit)
      return tagMenu(ref, commit)
    }

    const push = async () => {
      if (!current) {
        toast.show('error', 'Not on a branch', 'Check out a branch before pushing.')
        return false
      }
      return pushBranch(current)
    }

    return {
      run,
      commitMenu,
      refMenu,
      stashMenu,
      uncommittedMenu,
      fetchAll,
      pull,
      push,
      stash,
      discardAll,
      createBranchAt,
      editUser,
      copy,
    }
  }, [repo, data, refresh, settings.fetchAndPrune, dialog, toast])
}
