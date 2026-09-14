import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { searchOrganizationQuests } from '../services/organizationQuestApi'
import { getQuestListView, saveQuestListView } from '../services/questListViews'
import { isAbortError } from '../services/requestCancellation'

const emptyPage = { items: [], next_cursor: null, has_more: false, pages: 0 }

export function useOrganizationQuestList({ userId, organizationId, enabled }) {
  const [initialView] = useState(() => getQuestListView(userId, organizationId))
  const [search, setSearchValue] = useState(initialView.search)
  const [status, setStatusValue] = useState(initialView.status)
  const [page, setPage] = useState(emptyPage)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const controller = useRef(null)
  const restore = useRef(true)
  const view = useRef(initialView)
  const request = useRef(null)

  const changeFilter = (nextSearch, nextStatus) => {
    controller.current?.abort()
    request.current = null
    restore.current = false
    setSearchValue(nextSearch)
    setStatusValue(nextStatus)
    setPage(emptyPage)
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    view.current = { search: nextSearch, status: nextStatus, pages: 1, scrollY: 0, focusId: null }
  }

  useEffect(() => {
    if (!enabled) return
    const active = new AbortController()
    controller.current = active
    const timeout = setTimeout(async () => {
      setLoading(true)
      setLoadingMore(false)
      setError(null)
      try {
        let next = { ...emptyPage }
        const targetPages = restore.current ? initialView.pages : 1
        for (let index = 0; index < targetPages; index++) {
          const result = await searchOrganizationQuests({ organizationId, search, status, cursor: next.next_cursor, signal: active.signal })
          if (active.signal.aborted) return
          const ids = new Set(next.items.map(item => item.id))
          next = { ...result, items: [...next.items, ...result.items.filter(item => !ids.has(item.id))], pages: index + 1 }
          if (!next.has_more) break
        }
        setPage(next)
        view.current = { ...view.current, search, status, pages: next.pages }
      } catch (err) {
        if (isAbortError(err, active.signal)) return
        setPage(emptyPage)
        setError(err)
      } finally {
        if (!active.signal.aborted) setLoading(false)
      }
    }, search === initialView.search && status === initialView.status ? 0 : 300)
    return () => { clearTimeout(timeout); active.abort(); controller.current?.abort(); request.current = null }
  }, [organizationId, search, status, enabled, revision, initialView])

  const loadMore = useCallback(async () => {
    if (!page.has_more || loading || loadingMore || request.current) return
    const active = new AbortController()
    controller.current?.abort()
    controller.current = active
    request.current = active
    setLoadingMore(true)
    setError(null)
    try {
      const result = await searchOrganizationQuests({ organizationId, search, status, cursor: page.next_cursor, signal: active.signal })
      if (active.signal.aborted) return
      setPage(previous => {
        const ids = new Set(previous.items.map(item => item.id))
        return { ...result, items: [...previous.items, ...result.items.filter(item => !ids.has(item.id))], pages: previous.pages + 1 }
      })
      view.current = { ...view.current, pages: page.pages + 1 }
    } catch (err) {
      if (!isAbortError(err, active.signal)) {
        if (String(err?.code) === '42501') setPage(emptyPage)
        setError(err)
      }
    } finally {
      if (request.current === active) request.current = null
      if (!active.signal.aborted) setLoadingMore(false)
    }
  }, [organizationId, search, status, page, loading, loadingMore])

  useLayoutEffect(() => {
    if (loading || error || !restore.current) return
    restore.current = false
    const frame = requestAnimationFrame(() => {
      document.getElementById(initialView.focusId)?.focus({ preventScroll: true })
      window.scrollTo({ top: initialView.scrollY })
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, error, initialView])

  useLayoutEffect(() => () => {
    controller.current?.abort()
    saveQuestListView(userId, organizationId, { ...view.current, scrollY: window.scrollY })
  }, [userId, organizationId])

  return {
    ...page, search, status, loading: enabled && loading, loadingMore, error, loadMore,
    setSearch: value => changeFilter(value, status),
    setStatus: value => changeFilter(search, value),
    rememberFocus: id => { view.current = { ...view.current, focusId: id, scrollY: window.scrollY } },
    refresh: () => { restore.current = false; controller.current?.abort(); request.current = null; setPage(emptyPage); setLoading(true); setRevision(value => value + 1) },
  }
}
