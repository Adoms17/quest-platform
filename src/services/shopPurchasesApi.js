import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export async function listShopPurchases(organizationId, signal) {
  if (!uuid(organizationId)) throw new Error('Выберите организацию.')
  const { data, error } = await withAbortSignal(supabase.rpc('list_organization_shop_purchases', {
    p_organization_id: organizationId,
  }), signal)
  if (error) throw error
  if (!Array.isArray(data) || data.some(item => !uuid(item.acquisition_id) || item.organization_id !== organizationId
    || !uuid(item.version_id) || typeof item.title !== 'string' || typeof item.version_label !== 'string'
    || typeof item.copy_available !== 'boolean' || (item.quest_id !== null && !uuid(item.quest_id)))) {
    throw new Error('Не удалось проверить список покупок. Повторите загрузку.')
  }
  return data
}

// Acquisition itself is the server idempotency key; retries never issue a second original.
export async function issueShopCopy(organizationId, acquisitionId) {
  if (!uuid(organizationId) || !uuid(acquisitionId)) throw new Error('Не удалось определить покупку и организацию.')
  const { data, error } = await supabase.rpc('issue_shop_quest_copy', {
    p_organization_id: organizationId, p_acquisition_id: acquisitionId,
  })
  if (error) throw error
  if (!uuid(data)) throw new Error('Не удалось подтвердить создание копии. Повторите запрос.')
  return data
}
