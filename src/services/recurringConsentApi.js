import { supabase } from '../supabaseClient'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unavailable = () => new Error('Не удалось обновить согласие. Повторите проверку.')
export async function readRecurringConsent(organizationId, orderId) {
  if (!uuid.test(organizationId) || !uuid.test(orderId)) throw unavailable()
  const { data, error } = await supabase.rpc('read_sandbox_recurring_consent', { p_organization_id: organizationId, p_order_id: orderId })
  if (error || !data || !['none', 'pending', 'saved', 'revoked'].includes(data.state) || typeof data.can_request !== 'boolean' || (data.state !== 'none' && !uuid.test(data.consent_id))) throw unavailable()
  return { state: data.state, canRequest: data.can_request, consentId: data.consent_id }
}
export async function requestRecurringConsent(organizationId, orderId) {
  if (!uuid.test(organizationId) || !uuid.test(orderId)) throw unavailable()
  const { error } = await supabase.rpc('request_sandbox_recurring_consent', { p_organization_id: organizationId, p_order_id: orderId, p_terms_version: 'sandbox-recurring-v2' })
  if (error) throw unavailable()
  return readRecurringConsent(organizationId, orderId)
}
export async function revokeRecurringConsent(organizationId, orderId, consentId) {
  if (!uuid.test(organizationId) || !uuid.test(orderId) || !uuid.test(consentId)) throw unavailable()
  const { data, error } = await supabase.rpc('revoke_sandbox_recurring_consent', { p_organization_id: organizationId, p_consent_id: consentId })
  if (error || data !== 'revoked') throw unavailable()
  return readRecurringConsent(organizationId, orderId)
}

export async function listRecurringConsents(organizationId) {
 if (!uuid.test(organizationId)) throw unavailable()
 const { data, error } = await supabase.rpc('list_sandbox_recurring_consents', { p_organization_id: organizationId })
 if (error || !Array.isArray(data) || !data.every(item => item && uuid.test(item.consent_id) && uuid.test(item.order_id)
  && ['pending', 'saved', 'revoked'].includes(item.state) && typeof item.created_at === 'string' && Number.isFinite(Date.parse(item.created_at)))
  || new Set(data.map(item => item.consent_id)).size !== data.length) throw unavailable()
 return data.map(item => ({ consentId: item.consent_id, orderId: item.order_id, state: item.state, createdAt: item.created_at }))
}