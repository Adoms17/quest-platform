import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export async function searchOrganizationTeam(organizationId, kind, { search = '', status = 'all', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_organization_team_catalog', {
    p_organization_id: organizationId, p_kind: kind, p_search: search.trim(), p_status: status, p_after: cursor, p_limit: limit,
  }), signal)
  if (error) throw error
  if (data?.organization_id !== organizationId || data.kind !== kind || data.status !== status
    || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) {
    throw new Error('Некорректный ответ каталога команды.')
  }
  return data
}

export async function searchOrganizationAudit(organizationId, { category = 'all', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_organization_audit', {
    p_organization_id: organizationId, p_category: category, p_after: cursor, p_limit: limit,
  }), signal)
  if (error) throw error
  if (data?.organization_id !== organizationId || data.category !== category || !Array.isArray(data.items)
    || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ журнала организации.')
  return data
}
