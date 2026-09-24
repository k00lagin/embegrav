import type { DragEvent, MouseEvent } from 'react'
import type { GitRef, StashInfo } from '@shared/types'
import IconGitBranch from '~icons/lucide/git-branch'
import IconTag from '~icons/lucide/tag'
import IconCloud from '~icons/lucide/cloud'
import IconArchive from '~icons/lucide/archive'
import IconCheck from '~icons/lucide/check'

export type LabelTarget =
  /** synced: remote-tracking branch pointing at the same commit, shown in the same label */
  | { kind: 'ref'; ref: GitRef; synced?: GitRef }
  | { kind: 'stash'; stash: StashInfo }
  | { kind: 'head' }

/** Drag-and-drop payload type for local branch labels. */
export const BRANCH_DRAG_TYPE = 'application/x-embegrav-branch'

interface Props {
  target: LabelTarget
  color: string
  current?: boolean
  onContextMenu?: (e: MouseEvent, target: LabelTarget) => void
  onClick?: (e: MouseEvent, target: LabelTarget) => void
}

export function RefLabel({ target, color, current, onContextMenu, onClick }: Props) {
  let icon
  let text
  let title
  let branch: string | undefined
  if (target.kind === 'ref') {
    const r = target.ref
    icon =
      r.type === 'tag' ? (
        <IconTag className="w-3 h-3" />
      ) : r.type === 'remote' ? (
        <IconCloud className="w-3 h-3" />
      ) : (
        <IconGitBranch className="w-3 h-3" />
      )
    text = r.name
    title =
      r.type === 'tag'
        ? `Tag: ${r.name}`
        : r.type === 'remote'
          ? `Remote branch: ${r.name}`
          : `Branch: ${r.name}`
    if (target.synced) title += `\nIn sync with ${target.synced.name}`
    if (r.type === 'head') {
      branch = r.name
      title += '\nDrag onto a commit or branch to merge or rebase'
    }
  } else if (target.kind === 'stash') {
    icon = <IconArchive className="w-3 h-3" />
    text = target.stash.selector
    title = `Stash: ${target.stash.message}`
  } else {
    icon = <IconCheck className="w-3 h-3" />
    text = 'HEAD'
    title = 'Detached HEAD'
  }
  const synced = target.kind === 'ref' ? target.synced : undefined
  return (
    <span
      className={`ref-label${current ? ' current' : ''}`}
      style={{ '--ref-color': color } as React.CSSProperties}
      title={title}
      data-branch={branch}
      draggable={branch !== undefined}
      onDragStart={(e: DragEvent) => {
        if (!branch) return
        e.dataTransfer.setData(BRANCH_DRAG_TYPE, branch)
        e.dataTransfer.setData('text/plain', branch)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(e, target)
        }
      }}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation()
          onClick(e, target)
        }
      }}
    >
      {current && <IconCheck className="w-3 h-3" />}
      {!current && icon}
      <span className="truncate">{text}</span>
      {synced && (
        <span className="ref-label-remote">
          ⇄ <IconCloud className="w-3 h-3" />
          {synced.remote ?? synced.name.split('/')[0]}
        </span>
      )}
    </span>
  )
}
