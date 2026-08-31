import { describe, expect, it, vi } from 'vitest'
import { createSyncCoordinator } from './syncCoordinator'

describe('createSyncCoordinator', () => {
  it('retries synchronization after a transport failure', async () => {
    vi.useFakeTimers()
    const error = new TypeError('Failed to fetch')
    const runSync = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)
    const coordinator = createSyncCoordinator({
      runSync,
      isOnline: () => true,
      isRetryableError: candidate => candidate === error,
      retryDelays: [10],
    })

    await coordinator.trigger()
    await vi.advanceTimersByTimeAsync(10)

    expect(runSync).toHaveBeenCalledTimes(2)
    coordinator.stop()
    vi.useRealTimers()
  })

  it('reruns when an event arrives during synchronization', async () => {
    let resolveFirst
    const firstRun = new Promise(resolve => {
      resolveFirst = resolve
    })
    const runSync = vi.fn()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValueOnce(undefined)
    const coordinator = createSyncCoordinator({
      runSync,
      isOnline: () => true,
      isRetryableError: () => false,
    })

    const running = coordinator.trigger()
    coordinator.requestPendingSync()
    resolveFirst()
    await running

    await vi.waitFor(() => {
      expect(runSync).toHaveBeenCalledTimes(2)
    })

    coordinator.stop()
  })

  it('keeps a queued event armed until connectivity returns', async () => {
    vi.useFakeTimers()
    let online = false
    const runSync = vi.fn().mockResolvedValue(undefined)
    const coordinator = createSyncCoordinator({
      runSync,
      isOnline: () => online,
      isRetryableError: () => true,
      retryDelays: [10],
    })

    coordinator.requestPendingSync()
    expect(runSync).not.toHaveBeenCalled()

    online = true
    await vi.advanceTimersByTimeAsync(10)

    expect(runSync).toHaveBeenCalledTimes(1)
    coordinator.stop()
    vi.useRealTimers()
  })
})
