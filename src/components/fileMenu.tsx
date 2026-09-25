import type { ChangedFile } from '@shared/types'
import { separatorFor } from '@/lib/paths'
import type { DiffTarget } from './DiffViewer'
import type { MenuEntry } from './ContextMenu'
import IconFileDiff from '~icons/lucide/file-diff'
import IconFileCode from '~icons/lucide/file-code'
import IconCopy from '~icons/lucide/copy'

export function withWorkingFile(target: DiffTarget): DiffTarget {
  const { file } = target
  const deleted = file.status === 'D'
  const revision = deleted ? target.from : target.to
  return {
    ...target,
    file: {
      ...file,
      path: deleted ? (file.oldPath ?? file.path) : file.path,
      oldPath: undefined,
      status: 'M',
      additions: null,
      deletions: null,
    },
    from: revision,
    to: 'WORKING',
    label: `${revision} → Working tree`,
    workingComparison: true,
  }
}

/** Common file actions, shared by commit, comparison, staged and working trees. */
export function createFileMenu(
  repo: string,
  targetFor: (file: ChangedFile) => DiffTarget,
  open: (target: DiffTarget) => void,
  copy: (text: string, label: string) => Promise<void>,
  extraFor?: (file: ChangedFile | undefined, path: string, isDirectory: boolean) => MenuEntry[],
) {
  return (file: ChangedFile | undefined, path: string, isDirectory: boolean): MenuEntry[] => {
    const entries: MenuEntry[] = []
    if (file && !isDirectory) {
      const target = targetFor(file)
      const deleted = file.status === 'D'
      const revision = deleted ? target.from : target.to
      entries.push(
        { label: 'View Diff', icon: <IconFileDiff />, onClick: () => open(target) },
        {
          label: deleted ? 'View File before Deletion' : 'View File at this Revision',
          icon: <IconFileCode />,
          onClick: () => open({ ...target, view: deleted ? 'before' : 'after' }),
        },
        {
          label: 'View Diff with Working File',
          icon: <IconFileDiff />,
          disabled: revision === 'WORKING',
          onClick: () => open(withWorkingFile(target)),
        },
        {
          label: 'Open Working File',
          icon: <IconFileCode />,
          onClick: () => open({ ...target, view: 'working' }),
        },
        'separator',
      )
    }
    const extra = extraFor?.(file, path, isDirectory) ?? []
    if (extra.length) entries.push(...extra, 'separator')
    const separator = separatorFor(repo)
    const absolute = `${repo.replace(/[\\/]$/, '')}${separator}${path.split('/').join(separator)}`
    entries.push(
      {
        label: 'Copy Absolute File Path',
        icon: <IconCopy />,
        onClick: () => void copy(absolute, 'Absolute path'),
      },
      {
        label: 'Copy Relative File Path',
        icon: <IconCopy />,
        onClick: () => void copy(path, 'Relative path'),
      },
    )
    return entries
  }
}
