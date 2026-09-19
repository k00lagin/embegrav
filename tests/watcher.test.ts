import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { FSWatcher, WatchListener, WatchOptions } from 'node:fs'
import type { PathLike } from 'node:fs'
import { git } from '../server/git.ts'
import { subscribe } from '../server/watcher.ts'

const { watch } = vi.hoisted(() => ({
  watch:
    vi.fn<(path: PathLike, options: WatchOptions, listener: WatchListener<string>) => FSWatcher>(),
}))

vi.mock('../server/git.ts', () => ({ git: vi.fn() }))
vi.mock('node:fs', () => ({ watch }))

class TestWatcher extends EventEmitter {
  close = vi.fn()
  ref() {
    return this
  }
  unref() {
    return this
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('shares initialization, retains remaining subscribers, and closes after the final unsubscribe', async () => {
  vi.useFakeTimers()
  let resolveGit!: (value: string) => void
  vi.mocked(git).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveGit = resolve
      }),
  )
  const watcher = new TestWatcher()
  watch.mockImplementation((_path, _options, onChange) => {
    watcher.on('change', onChange)
    return watcher
  })
  const firstListener = vi.fn()
  const secondListener = vi.fn()
  const first = subscribe('concurrent-repo', firstListener)
  const second = subscribe('concurrent-repo', secondListener)
  let secondReady = false
  void second.then(() => {
    secondReady = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(secondReady).toBe(false)
  resolveGit('/temporary/git-dir\n')
  const [stopFirst, stopSecond] = await Promise.all([first, second])
  expect(git).toHaveBeenCalledTimes(1)
  expect(watch).toHaveBeenCalledTimes(1)
  stopSecond()
  expect(watcher.close).not.toHaveBeenCalled()
  watcher.emit('change', 'change', 'HEAD')
  await vi.advanceTimersByTimeAsync(400)
  expect(firstListener).toHaveBeenCalledTimes(1)
  expect(secondListener).not.toHaveBeenCalled()
  watcher.emit('change', 'change', 'HEAD')
  stopFirst()
  await vi.advanceTimersByTimeAsync(400)
  expect(firstListener).toHaveBeenCalledTimes(1)
  expect(watcher.close).toHaveBeenCalledTimes(1)

  vi.mocked(git).mockResolvedValueOnce('/temporary/git-dir\n')
  const replacement = new TestWatcher()
  watch.mockReturnValue(replacement)
  const stopReplacement = await subscribe('concurrent-repo', vi.fn())
  stopFirst() // An old cleanup must not remove a replacement entry.
  expect(replacement.close).not.toHaveBeenCalled()
  stopReplacement()
  expect(replacement.close).toHaveBeenCalledTimes(1)
})

it('allows a later subscription to retry after initialization fails', async () => {
  vi.mocked(git).mockRejectedValueOnce(new Error('repository removed'))
  const stop = await subscribe('retry-repo', vi.fn())
  stop()
  const watcher = new TestWatcher()
  vi.mocked(git).mockResolvedValueOnce('/temporary/recreated-git-dir\n')
  watch.mockReturnValue(watcher)
  const stopRetry = await subscribe('retry-repo', vi.fn())
  expect(watch).toHaveBeenCalledTimes(1)
  stopRetry()
  expect(watcher.close).toHaveBeenCalledTimes(1)
})
