import type { MouseEvent } from 'react'
import type { GitRef, StashInfo } from '@shared/types'
import IconGitBranch from '~icons/lucide/git-branch'
import IconTag from '~icons/lucide/tag'
import IconCloud from '~icons/lucide/cloud'
import IconArchive from '~icons/lucide/archive'
import IconCheck from '~icons/lucide/check'

export type LabelTarget =
  | { kind: 'ref'; ref: GitRef }
  | { kind: 'stash'; stash: StashInfo }
  | { kind: 'head' }

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
  } else if (target.kind === 'stash') {
    icon = <IconArchive className="w-3 h-3" />
    text = target.stash.selector
    title = `Stash: ${target.stash.message}`
  } else {
    icon = <IconCheck className="w-3 h-3" />
    text = 'HEAD'
    title = 'Detached HEAD'
  }
  return (
    <span
      className={`ref-label${current ? ' current' : ''}`}
      style={{ '--ref-color': color } as React.CSSProperties}
      title={title}
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
    </span>
  )
}
