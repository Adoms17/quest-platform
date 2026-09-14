import { useEffect, useState } from 'react'
import { loadParticipantDashboard, PARTICIPANT_DASHBOARD_CHANGED } from '../services/participantDashboard'
import { SYNC_COMPLETE_EVENT } from '../services/sync'
import { PENDING_RESULT_ENQUEUED_EVENT } from '../services/syncSignals'
import { isAbortError } from '../services/requestCancellation'

export function useParticipantDashboard(userId) {
  const [state, setState] = useState({ data: null, loading: true, error: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let controller
    const refresh = () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      setState(old => ({ ...old, loading: true, error: false }))
      loadParticipantDashboard(userId, signal).then(data => {
        if (!signal.aborted) setState({ data, loading: false, error: false })
      }).catch(error => {
        if (!isAbortError(error, signal)) setState({ data: null, loading: false, error: true })
      })
    }
    const events = ['focus', 'online', 'offline', SYNC_COMPLETE_EVENT, PENDING_RESULT_ENQUEUED_EVENT, PARTICIPANT_DASHBOARD_CHANGED]
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    const timeout = setTimeout(refresh, 0)
    events.forEach(event => window.addEventListener(event, refresh))
    document.addEventListener('visibilitychange', visible)
    // Срок offline-доступа может истечь в открытой вкладке.
    const timer = setInterval(refresh, 60000)
    return () => {
      clearTimeout(timeout); clearInterval(timer); controller?.abort()
      events.forEach(event => window.removeEventListener(event, refresh))
      document.removeEventListener('visibilitychange', visible)
    }
  }, [userId, revision])
  return { ...state, refresh: () => setRevision(value => value + 1) }
}
