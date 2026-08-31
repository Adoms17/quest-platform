const DEFAULT_RETRY_DELAYS = [2000, 5000, 15000, 30000]

export function createSyncCoordinator({
  runSync,
  isOnline,
  isRetryableError,
  onError = () => {},
  retryDelays = DEFAULT_RETRY_DELAYS,
}) {
  let stopped = false
  let inFlight = false
  let rerunRequested = false
  let pendingRetryArmed = false
  let retryIndex = 0
  let retryTimer = null

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== null) return

    const delay = retryDelays[
      Math.min(retryIndex, retryDelays.length - 1)
    ]
    retryIndex = Math.min(retryIndex + 1, retryDelays.length - 1)

    retryTimer = setTimeout(() => {
      retryTimer = null
      void trigger()
    }, delay)
  }

  async function trigger() {
    if (stopped) return

    if (inFlight) {
      rerunRequested = true
      return
    }

    if (!isOnline()) {
      if (pendingRetryArmed) scheduleRetry()
      return
    }

    inFlight = true

    try {
      await runSync()
      retryIndex = 0
      clearRetry()

      if (!rerunRequested) {
        pendingRetryArmed = false
      }
    } catch (error) {
      onError(error)

      if (isRetryableError(error)) {
        pendingRetryArmed = true
        scheduleRetry()
      } else {
        pendingRetryArmed = false
      }
    } finally {
      inFlight = false

      if (rerunRequested && !stopped) {
        rerunRequested = false
        void trigger()
      }
    }
  }

  function triggerImmediately() {
    retryIndex = 0
    clearRetry()
    void trigger()
  }

  function requestPendingSync() {
    pendingRetryArmed = true
    void trigger()
  }

  function stop() {
    stopped = true
    clearRetry()
  }

  return {
    trigger,
    triggerImmediately,
    requestPendingSync,
    stop,
  }
}
