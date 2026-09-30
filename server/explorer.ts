import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The path is passed as data in the environment, never interpolated into PowerShell code.
const EXPLORE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ExplorerWindow {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$shell = New-Object -ComObject Shell.Application
$opened = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  foreach ($window in $shell.Windows()) {
    try {
      if ($window.Document.Folder.Self.Path -eq $env:EMBEGRAV_REVEAL_PATH) {
        $opened = $true
        $handle = [IntPtr]$window.HWND
        $window.Visible = $true
        if ([ExplorerWindow]::IsIconic($handle)) {
          [void][ExplorerWindow]::ShowWindowAsync($handle, 9)
        }
        if (!$window.Visible -or [ExplorerWindow]::IsIconic($handle)) { continue }
        if ($env:EMBEGRAV_REVEAL_FILE) {
          $item = $window.Document.Folder.ParseName($env:EMBEGRAV_REVEAL_FILE)
          if (!$item) { continue }
          $window.Document.SelectItem($item, 29)
        }
        [void][ExplorerWindow]::SetForegroundWindow($handle)
        exit 0
      }
    } catch { }
  }
  if (!$opened) {
    $shell.ShellExecute($env:EMBEGRAV_REVEAL_PATH, '', '', 'open', 1)
    $opened = $true
  }
  Start-Sleep -Milliseconds 100
}
throw 'Could not reveal the path in a visible File Explorer window'
`

/** Resolve a working-tree path without allowing navigation outside the registered repo.
 * Deleted paths reveal their nearest existing parent folder. */
export async function workingRevealPath(repo: string, filePath: unknown): Promise<string> {
  if (typeof filePath !== 'string' || filePath.includes('\0') || isAbsolute(filePath)) {
    throw new Error('A relative repository path is required')
  }
  const root = resolve(repo)
  let target = resolve(root, filePath)
  const within = relative(root, target)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error('Path must be inside the repository')
  }
  while (true) {
    try {
      await stat(target)
      return target
    } catch (e) {
      if (
        !['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '') ||
        target === root
      )
        throw e
      target = dirname(target)
    }
  }
}

/** Open the repository folder with the server machine's file manager. */
export async function revealInFileExplorer(path: string): Promise<void> {
  const target = resolve(path)
  const isDirectory = (await stat(target)).isDirectory()
  const folder = isDirectory ? target : dirname(target)
  if (process.platform === 'win32') {
    // Reuse and show the folder's window, restoring it if minimized. Shell.Explore
    // can leave a hidden window when invoked from this hidden PowerShell helper.
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(EXPLORE_SCRIPT, 'utf16le').toString('base64'),
      ],
      {
        env: {
          ...process.env,
          EMBEGRAV_REVEAL_PATH: folder,
          EMBEGRAV_REVEAL_FILE: isDirectory ? '' : basename(target),
        },
        windowsHide: true,
        timeout: 10_000,
      },
    )
    return
  }
  await run(
    process.platform === 'darwin' ? 'open' : 'xdg-open',
    process.platform === 'darwin' && !isDirectory ? ['-R', target] : [folder],
    { timeout: 10_000 },
  )
}
