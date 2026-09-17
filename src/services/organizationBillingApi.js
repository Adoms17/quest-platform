import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export async function loadOrganizationBilling(organizationId, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('get_organization_billing_overview', {
    p_organization_id: organizationId,
  }), signal)
  if (error) throw error
  const count = value => Number.isSafeInteger(value) && value >= 0
  if (data?.organization_id !== organizationId || typeof data.status !== 'string'
    || typeof data.can_manage !== 'boolean' || !Number.isFinite(Date.parse(data.measured_at))
    || !['active_quests', 'team_members'].every(key => count(data.usage?.[key])
      && typeof data.enforcement?.[key] === 'boolean'
      && (data.effective_entitlements === null || count(data.effective_entitlements?.[key])))) {
    throw new Error('Некорректный ответ тарифа организации.')
  }
  return data
}
