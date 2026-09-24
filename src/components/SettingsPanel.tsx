import { useRef } from 'react'
import type { Settings } from '@/lib/settings'
import { BUILT_IN_THEMES, useTheme } from '@/theme/ThemeProvider'
import { parseThemeJson } from '@/theme/vscode'
import { useToast } from './Toast'
import IconX from '~icons/lucide/x'
import IconUpload from '~icons/lucide/upload'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  userName: string
  userEmail: string
  onEditUser: () => void
}

type BooleanSetting = {
  [Key in keyof Settings]: Settings[Key] extends boolean ? Key : never
}[keyof Settings]

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  userName,
  userEmail,
  onEditUser,
}: Props) {
  const theme = useTheme()
  const fileInput = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const check = (key: BooleanSetting, label: string, description?: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={settings[key]}
        onChange={(e) => onChange({ [key]: e.target.checked })}
      />
      <span>
        {label}
        {description && <div className="text-fg-dim text-xs">{description}</div>}
      </span>
    </label>
  )

  const importTheme = async (file: File) => {
    try {
      const parsed = parseThemeJson(await file.text())
      if (!parsed.name) parsed.name = file.name.replace(/\.[^.]+$/, '')
      theme.setTheme(parsed)
    } catch (e) {
      toast.show('error', 'Could not import theme', (e as Error).message)
    }
  }

  return (
    <div className="modal-backdrop pt-[8vh]" onMouseDown={onClose}>
      <div
        className="modal w-[540px] max-w-[92vw] max-h-[84vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center">
          <span className="flex-1">Settings</span>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <IconX className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-fg-muted uppercase text-xs tracking-wide">Graph</h3>
            <label className="flex items-center gap-2">
              <span className="w-44">Commit ordering</span>
              <select
                value={settings.order}
                onChange={(e) => onChange({ order: e.target.value as Settings['order'] })}
              >
                <option value="date">Date order</option>
                <option value="author-date">Author date order</option>
                <option value="topo">Topological order</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-44">Initial commit count</span>
              <select
                value={settings.maxCommits}
                onChange={(e) => onChange({ maxCommits: Number(e.target.value) })}
              >
                {[100, 300, 500, 1000, 2000, 5000].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {check('showRemoteBranches', 'Show remote branches')}
            {check('showTags', 'Show tags')}
            {check('showStashes', 'Show stashes')}
            {check(
              'showUncommitted',
              'Show uncommitted changes',
              'Displays a row for the working tree at the top of the graph.',
            )}
            {check(
              'autoRefresh',
              'Auto refresh',
              'Reload the graph when the repository changes on disk.',
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-fg-muted uppercase text-xs tracking-wide">Display</h3>
            <label className="flex items-center gap-2">
              <span className="w-44">Date format</span>
              <select
                value={settings.dateFormat}
                onChange={(e) => onChange({ dateFormat: e.target.value as Settings['dateFormat'] })}
              >
                <option value="datetime">Date &amp; time</option>
                <option value="date">Date only</option>
                <option value="relative">Relative</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-44">Date type</span>
              <select
                value={settings.dateType}
                onChange={(e) => onChange({ dateType: e.target.value as Settings['dateType'] })}
              >
                <option value="author">Author date</option>
                <option value="commit">Commit date</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-44">Commit view</span>
              <select
                value={settings.commitView}
                onChange={(e) => onChange({ commitView: e.target.value as Settings['commitView'] })}
              >
                <option value="unified">Unified</option>
                <option value="split">Split</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-44">Diff view</span>
              <select
                value={settings.diffStyle}
                onChange={(e) => onChange({ diffStyle: e.target.value as Settings['diffStyle'] })}
              >
                <option value="unified">Unified</option>
                <option value="split">Split</option>
              </select>
            </label>
            {check(
              'showCommitter',
              'Show committer',
              'Show the committer next to the author when they differ.',
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-fg-muted uppercase text-xs tracking-wide">Theme</h3>
            <div className="flex items-center gap-2">
              <span className="w-44">Colour theme</span>
              <select
                className="flex-1"
                value={
                  theme.isCustom && !BUILT_IN_THEMES.some((t) => t.name === theme.theme.name)
                    ? '__custom'
                    : theme.theme.name
                }
                onChange={(e) => {
                  const t = BUILT_IN_THEMES.find((b) => b.name === e.target.value)
                  if (t) theme.setTheme(t === BUILT_IN_THEMES[0] ? null : t)
                }}
              >
                {BUILT_IN_THEMES.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
                {theme.isCustom && !BUILT_IN_THEMES.some((t) => t.name === theme.theme.name) && (
                  <option value="__custom">{theme.theme.name ?? 'Imported theme'}</option>
                )}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => fileInput.current?.click()}
                title="Import a VS Code theme JSON file"
              >
                <IconUpload className="w-3.5 h-3.5" /> Import…
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,.jsonc,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importTheme(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="text-fg-dim text-xs">
              Any VS Code colour theme JSON works: its <span className="mono">colors</span> become{' '}
              <span className="mono">--vscode-*</span> CSS variables and its{' '}
              <span className="mono">tokenColors</span> drive syntax highlighting in diffs.
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-fg-muted uppercase text-xs tracking-wide">Remote</h3>
            {check(
              'fetchAndPrune',
              'Prune when fetching',
              'Remove remote-tracking references that no longer exist on the remote.',
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-fg-muted uppercase text-xs tracking-wide">Repository</h3>
            <div className="flex items-center gap-2">
              <span className="w-44">User</span>
              <span className="flex-1 truncate">
                {userName || <em className="text-fg-dim">not set</em>}{' '}
                <span className="text-fg-muted">{userEmail && `<${userEmail}>`}</span>
              </span>
              <button type="button" className="btn btn-secondary" onClick={onEditUser}>
                Edit
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
