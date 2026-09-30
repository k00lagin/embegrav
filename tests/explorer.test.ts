import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))
import { revealInFileExplorer, workingRevealPath } from '../server/explorer.ts'

let folder: string | undefined
afterEach(async () => {
  execFile.mockReset()
  if (folder) await rm(folder, { recursive: true, force: true })
  folder = undefined
})

it('waits for the system opener to finish and reports its errors', async () => {
  folder = await mkdtemp(join(tmpdir(), 'embegrav-explorer-'))
  const opening = revealInFileExplorer(folder)
  const rejected = expect(opening).rejects.toThrow('Opening failed')
  await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(1))
  const callback = execFile.mock.calls[0].at(-1) as (error: Error) => void
  callback(new Error('Opening failed'))
  await rejected
})

it.skipIf(process.platform !== 'win32')(
  'requests a visible Explorer window while keeping the helper hidden and the path as data',
  async () => {
    folder = await mkdtemp(join(tmpdir(), "embegrav path $&'-"))
    const opening = revealInFileExplorer(folder)
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(1))
    const [command, args, options, callback] = execFile.mock.calls[0]
    expect(command).toMatch(/WindowsPowerShell.*powershell\.exe$/)
    expect(options.env.EMBEGRAV_REVEAL_PATH).toBe(folder)
    expect(options.windowsHide).toBe(true)
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
    expect(script).toContain("$shell.ShellExecute($env:EMBEGRAV_REVEAL_PATH, '', '', 'open', 1)")
    expect(script).not.toContain(folder)
    callback(null, '', '')
    await opening
  },
)

it('rejects missing folders without launching the opener', async () => {
  folder = await mkdtemp(join(tmpdir(), 'embegrav-explorer-'))
  await expect(revealInFileExplorer(join(folder, 'missing'))).rejects.toThrow()
  expect(execFile).not.toHaveBeenCalled()
})

it('reveals existing paths and falls back to the parent for deleted paths', async () => {
  folder = await mkdtemp(join(tmpdir(), 'embegrav-explorer-'))
  await mkdir(join(folder, 'src'))
  await writeFile(join(folder, 'src', 'file.txt'), 'content')
  expect(await workingRevealPath(folder, 'src/file.txt')).toBe(join(folder, 'src', 'file.txt'))
  expect(await workingRevealPath(folder, 'src/deleted/file.txt')).toBe(join(folder, 'src'))
  await expect(workingRevealPath(folder, '../outside')).rejects.toThrow('inside the repository')
  await expect(workingRevealPath(folder, folder)).rejects.toThrow('relative repository path')
})

it.skipIf(process.platform !== 'win32')(
  'opens the parent and selects files in Windows Explorer',
  async () => {
    folder = await mkdtemp(join(tmpdir(), 'embegrav-explorer-'))
    const file = join(folder, "file $&'.txt")
    await writeFile(file, 'content')
    const opening = revealInFileExplorer(file)
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(1))
    const [, , options, callback] = execFile.mock.calls[0]
    expect(options.env.EMBEGRAV_REVEAL_PATH).toBe(folder)
    expect(options.env.EMBEGRAV_REVEAL_FILE).toBe("file $&'.txt")
    callback(null, '', '')
    await opening
  },
)
