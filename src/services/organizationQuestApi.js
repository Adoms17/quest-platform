import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export const ORGANIZATION_QUEST_PAGE_SIZE = 25

export async function searchOrganizationQuests({ organizationId, search = '', status = 'all', cursor = null, signal }) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_organization_quests', {
    p_organization_id: organizationId,
    p_search: search.trim(),
    p_status: status,
    p_after: cursor,
    p_limit: ORGANIZATION_QUEST_PAGE_SIZE,
  }), signal)
  if (error) throw error
  if (!data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) {
    throw new Error('Некорректный ответ списка квестов')
  }
  return data
}
