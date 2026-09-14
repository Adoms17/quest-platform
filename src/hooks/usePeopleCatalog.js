import { useEffect, useMemo, useRef, useState } from 'react'
import { searchParticipantArchive, searchArchivedGroupInvitations, searchSupervisionProfiles, searchParticipantProfiles, searchParticipantGroups, searchParticipantGroupMembers, searchGroupInvitations, searchProfileInvitations, searchParticipantSupervisors, searchParticipantAudit } from '../services/peopleCatalogApi'
import { isAbortError } from '../services/requestCancellation'

const EMPTY_ITEMS = []
export function usePeopleCatalog(actorId, kind, search, revision, groupId = null) {
  const enabled = Boolean(actorId && (!['archived-invitations', 'members', 'invitations', 'profile-invitations', 'supervisors', 'audit'].includes(kind) || groupId))
  const pageSize = 25
  const fetchPage = useMemo(() => kind === 'archive' ? searchParticipantArchive : kind === 'archived-invitations' ? (options, signal) => searchArchivedGroupInvitations(groupId, options, signal) : kind === 'supervision-profiles' ? searchSupervisionProfiles : kind === 'audit'
    ? (options, signal) => searchParticipantAudit(groupId, options, signal)
    : kind === 'supervisors'
    ? (options, signal) => searchParticipantSupervisors(groupId, options, signal)
    : kind === 'profile-invitations'
    ? (options, signal) => searchProfileInvitations(groupId, options, signal)
    : kind === 'invitations'
    ? (options, signal) => searchGroupInvitations(groupId, options, signal)
    : kind === 'members'
    ? (options, signal) => searchParticipantGroupMembers(groupId, options, signal)
    : kind === 'groups' ? searchParticipantGroups : searchParticipantProfiles, [kind, groupId])
  const key = useMemo(() => ({ actorId, search, kind, enabled, revision, pageSize, groupId }), [actorId, search, kind, enabled, revision, pageSize, groupId])
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
        if (!request.signal.aborted) setState({ key, group: page.group, items: page.items, cursor: page.next_cursor, hasMore: page.has_more, loading: false, moreLoading: false, error: false })
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
        if (old.group?.can_manage && page.group?.can_manage === false) {
          return { key, group: null, items: [], hasMore: false, moreLoading: false, loading: false, error: true, denied: true }
        }
        return { ...old, group: page.group, items: [...new Map([...old.items, ...page.items].map(item => [item.id, item])).values()], cursor: page.next_cursor, hasMore: page.has_more, moreLoading: false }
      })
    } catch (error) {
      if (!isAbortError(error, request.signal)) setState(old => old.key !== key ? old : ({ ...old, ...(error.code === '42501' ? { group: null, items: [], hasMore: false, denied: true } : {}), moreLoading: false, error: true }))
    } finally { if (!request.signal.aborted) pending.current = false }
  }
  return { ...current, loadMore }
}
