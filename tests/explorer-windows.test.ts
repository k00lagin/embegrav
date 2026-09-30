import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { revealInFileExplorer } from '../server/explorer.ts'

// Opt in on an interactive Windows desktop: this test opens its own Explorer window.
// $env:EMBEGRAV_TEST_EXPLORER = '1'; pnpm exec vitest run tests/explorer-windows.test.ts
const run = promisify(execFile)
const powershell = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

async function inspectWindows(folder: string, action = '') {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowProbe {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
}
'@
$shell = New-Object -ComObject Shell.Application
$views = @(foreach ($window in $shell.Windows()) {
  if ($window.Document.Folder.Self.Path -eq $env:EMBEGRAV_TEST_FOLDER) {
    $handle = [IntPtr]$window.HWND
    ${action}
    [pscustomobject]@{
      visible = [WindowProbe]::IsWindowVisible($handle)
      minimized = [WindowProbe]::IsIconic($handle)
      selected = @($window.Document.SelectedItems() | ForEach-Object { $_.Name })
    }
  }
})
ConvertTo-Json -InputObject $views -Compress
`
  const { stdout } = await run(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, timeout: 10_000, env: { ...process.env, EMBEGRAV_TEST_FOLDER: folder } },
  )
  return JSON.parse(stdout) as { visible: boolean; minimized: boolean; selected: string[] }[]
}

it.skipIf(process.platform !== 'win32' || process.env.EMBEGRAV_TEST_EXPLORER !== '1')(
  'shows hidden folders, restores minimized windows and selects files from a hidden helper',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "embegrav reveal $&'-"))
    const file = "file $&'.txt"
    try {
      await writeFile(join(folder, file), 'content')
      await revealInFileExplorer(folder)
      expect(await inspectWindows(folder)).toEqual([
        { visible: true, minimized: false, selected: [] },
      ])

      await inspectWindows(folder, '$window.Visible = $false')
      expect((await inspectWindows(folder))[0].visible).toBe(false)
      await revealInFileExplorer(folder)
      expect(await inspectWindows(folder)).toEqual([
        { visible: true, minimized: false, selected: [] },
      ])

      await inspectWindows(folder, '[void][WindowProbe]::ShowWindowAsync($handle, 6)')
      expect((await inspectWindows(folder))[0].minimized).toBe(true)
      await revealInFileExplorer(join(folder, file))
      expect(await inspectWindows(folder)).toEqual([
        { visible: true, minimized: false, selected: [file] },
      ])
    } finally {
      await inspectWindows(folder, '$window.Quit(); continue')
      await rm(folder, { recursive: true, force: true })
    }
  },
  30_000,
)
