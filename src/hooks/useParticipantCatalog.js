import { useEffect, useMemo, useRef, useState } from 'react'
import { searchParticipantQuests } from '../services/participantCatalogApi'
import { isAbortError } from '../services/requestCancellation'

const EMPTY_ITEMS = []
export function useParticipantCatalog(profileId, search, filter, enabled, revision, pageSize = 25) {
  const key = useMemo(() => ({ profileId, search, filter, enabled, revision, pageSize }), [profileId, search, filter, enabled, revision, pageSize])
  const [state, setState] = useState({ key: '', items: [], hasMore: false, loading: false, moreLoading: false, error: false })
  const controller = useRef(null)
  const pending = useRef(false)
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    pending.current = true
    if (!enabled || !profileId) { pending.current = false; return () => request.abort() }
    const timer = setTimeout(() => {
      setState({ key, items: [], hasMore: false, loading: true, moreLoading: false, error: false })
      searchParticipantQuests(profileId, { search, filter, limit: pageSize }, request.signal).then(page => {
        if (!request.signal.aborted) setState({ key, items: page.items, cursor: page.next_cursor, hasMore: page.has_more, loading: false, moreLoading: false, error: false })
      }).catch(error => {
        if (!isAbortError(error, request.signal)) setState({ key, items: [], hasMore: false, loading: false, moreLoading: false, error: true, denied: error.code === '42501' })
      }).finally(() => { if (!request.signal.aborted) pending.current = false })
    }, 300)
    return () => { clearTimeout(timer); request.abort() }
  }, [key, profileId, search, filter, enabled, pageSize])
  const current = enabled && state.key === key ? state : { items: EMPTY_ITEMS, hasMore: false, loading: Boolean(enabled && profileId), moreLoading: false, error: false }
  const loadMore = async () => {
    if (pending.current || !current.hasMore || !controller.current || controller.current.signal.aborted) return
    const request = controller.current
    pending.current = true
    setState(old => ({ ...old, moreLoading: true, error: false }))
    try {
      const page = await searchParticipantQuests(profileId, { search, filter, cursor: current.cursor, limit: pageSize }, request.signal)
      if (!request.signal.aborted) setState(old => old.key !== key ? old : ({ ...old, items: [...new Map([...old.items, ...page.items].map(item => [item.id, item])).values()], cursor: page.next_cursor, hasMore: page.has_more, moreLoading: false }))
    } catch (error) {
      if (!isAbortError(error, request.signal)) setState(old => old.key !== key ? old : ({ ...old, ...(error.code === '42501' ? { items: [], hasMore: false, denied: true } : {}), moreLoading: false, error: true }))
    } finally { if (!request.signal.aborted) pending.current = false }
  }
  return { ...current, loadMore }
}
