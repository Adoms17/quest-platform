import { useEffect, useRef, useState } from 'react'
import { searchParticipantQuestHistory } from '../services/participantHistoryApi'

export function useParticipantHistory(profileId) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ items: [], loading: Boolean(profileId) })
  const controller = useRef(null)
  const pending = useRef(false)
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    pending.current = Boolean(profileId)
    const timer = setTimeout(async () => {
      if (!profileId) return
      setState({ items: [], loading: true })
      try {
        const page = await searchParticipantQuestHistory(profileId, null, request.signal)
        if (!request.signal.aborted) setState({ ...page, loading: false })
      } catch (error) {
        if (!request.signal.aborted) setState({ items: [], loading: false, error: true, denied: error.code === '42501' })
      } finally { if (!request.signal.aborted) pending.current = false }
    }, 0)
    return () => { clearTimeout(timer); request.abort() }
  }, [profileId, revision])

  const loadMore = async () => {
    const request = controller.current
    if (pending.current || !state.has_more || !request || request.signal.aborted) return
    pending.current = true
    setState(old => ({ ...old, moreLoading: true, error: false }))
    try {
      const page = await searchParticipantQuestHistory(profileId, state.next_cursor, request.signal)
      if (!request.signal.aborted) setState(old => ({ ...page, items: [...new Map([...old.items, ...page.items].map(item => [item.quest_attempt_id, item])).values()], loading: false, moreLoading: false }))
    } catch (error) {
      if (!request.signal.aborted) setState(old => error.code === '42501'
        ? { items: [], error: true, denied: true, loading: false }
        : { ...old, error: true, moreLoading: false })
    } finally { if (!request.signal.aborted) pending.current = false }
  }
  return { ...state, loadMore, retry: () => setRevision(value => value + 1) }
}
