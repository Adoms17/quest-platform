import { supabase } from '../supabaseClient'

export async function recordAccountActivity(signal) {
  const { data, error } = await supabase.rpc('record_my_account_activity').abortSignal(signal)
  if (error) throw error
  if (!Number.isInteger(data) || data < 1 || data > 86400) throw new Error('Invalid activity interval')
  return data
}

// No timers, event history, input contents or offline queue. Only foreground use.
export function startAccountActivity({
  record = recordAccountActivity,
  document: target = document,
  isOnline = () => navigator.onLine,
  now = () => performance.now(),
} = {}) {
  const controller = new AbortController()
  let opened = false
  let inFlight = false
  let nextEligibleAt = 0

  async function observe() {
    if (controller.signal.aborted || target.visibilityState !== 'visible' || !isOnline() ||
      inFlight || now() < nextEligibleAt) return
    inFlight = true
    try {
      const retryAfterSeconds = await record(controller.signal)
      if (!controller.signal.aborted) nextEligibleAt = now() + retryAfterSeconds * 1000
    } catch {
      // Best effort: a failed observation must not block the app or create a retry loop.
      if (!controller.signal.aborted) nextEligibleAt = now() + 5 * 60 * 1000
    } finally {
      inFlight = false
    }
  }

  function onInitialVisibility() {
    if (opened || target.visibilityState !== 'visible') return
    opened = true
    void observe()
  }
  function onInteraction(event) {
    if (!event.isTrusted || event.repeat ||
      (event.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))) return
    void observe()
  }

  target.addEventListener('visibilitychange', onInitialVisibility)
  target.addEventListener('pointerdown', onInteraction, { capture: true, passive: true })
  target.addEventListener('keydown', onInteraction, { capture: true, passive: true })
  onInitialVisibility()
  return () => {
    controller.abort()
    target.removeEventListener('visibilitychange', onInitialVisibility)
    target.removeEventListener('pointerdown', onInteraction, true)
    target.removeEventListener('keydown', onInteraction, true)
  }
}
