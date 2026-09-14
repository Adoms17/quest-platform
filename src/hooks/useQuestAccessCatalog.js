import { useEffect, useMemo, useRef, useState } from 'react'
import { searchQuestAccess } from '../services/questAccessApi'
import { isAbortError } from '../services/requestCancellation'

const EMPTY_ITEMS = []
export function useQuestAccessCatalog(actorId, questId, kind, search, revision) {
  const enabled = Boolean(actorId && questId)
  const pageSize = 25
  const fetchPage = useMemo(() => (options, signal) => searchQuestAccess(questId, kind, options, signal), [questId, kind])
  const key = useMemo(() => ({ actorId, search, kind, enabled, revision, pageSize, questId }), [actorId, search, kind, enabled, revision, pageSize, questId])
  const [state, setState] = useState({ key: '', items: [], hasMore: false, loading: false, moreLoading: false, error: false })
  const controller = useRef(null)
  const pending = useRef(false)
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    pending.current = true
    if (!enabled || !actorId) { pending.current = false; return () => request.abort() }
    const timer = setTimeout(() => {
      setState({ key, items: [], hasMore: false, loading: true, moreLoading: false, error: false })
      fetchPage({ search, limit: pageSize }, request.signal).then(page => {
        if (!request.signal.aborted) setState({ key, items: page.items, cursor: page.next_cursor, hasMore: page.has_more, loading: false, moreLoading: false, error: false })
      }).catch(error => {
        if (!isAbortError(error, request.signal)) setState({ key, items: [], hasMore: false, loading: false, moreLoading: false, error: true, denied: error.code === '42501' })
      }).finally(() => { if (!request.signal.aborted) pending.current = false })
    }, 300)
    return () => { clearTimeout(timer); request.abort() }
  }, [key, actorId, search, kind, enabled, pageSize, fetchPage])
  const current = enabled && state.key === key ? state : { items: EMPTY_ITEMS, hasMore: false, loading: Boolean(enabled && actorId), moreLoading: false, error: false }
  const loadMore = async () => {
    if (pending.current || !current.hasMore || !controller.current || controller.current.signal.aborted) return
    const request = controller.current
    pending.current = true
    setState(old => ({ ...old, moreLoading: true, error: false }))
    try {
      const page = await fetchPage({ search, cursor: current.cursor, limit: pageSize }, request.signal)
      if (!request.signal.aborted) setState(old => {
        if (old.key !== key) return old
        return { ...old, items: [...new Map([...old.items, ...page.items].map(item => [item.id, item])).values()], cursor: page.next_cursor, hasMore: page.has_more, moreLoading: false }
      })
    } catch (error) {
      if (!isAbortError(error, request.signal)) setState(old => old.key !== key ? old : ({ ...old, ...(error.code === '42501' ? { items: [], hasMore: false, denied: true } : {}), moreLoading: false, error: true }))
    } finally { if (!request.signal.aborted) pending.current = false }
  }
  return { ...current, loadMore }
}
