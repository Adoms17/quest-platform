export const PENDING_RESULT_ENQUEUED_EVENT =
  'quest-pending-result-enqueued'

export function notifyPendingResultEnqueued() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PENDING_RESULT_ENQUEUED_EVENT))
  }
}
