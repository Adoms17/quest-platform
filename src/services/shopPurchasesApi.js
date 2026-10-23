import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export const SHOP_PURCHASE_TIMEOUT_MS = 15000

// Bound the local wait even when the transport ignores AbortSignal. Stopping
// this wait does not establish whether an issuance completed on the server.
async function request(name, params, signal, issuance = false) {
  if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError')
  let timer, cancel
  try {
    const interrupted = new Promise((_, reject) => {
      cancel = () => reject(new DOMException('Request canceled', 'AbortError'))
      signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => reject(Object.assign(new Error('Purchase request deadline exceeded'), {
        code: issuance ? 'SHOP_COPY_OUTCOME_UNKNOWN' : 'SHOP_PURCHASE_TIMEOUT',
      })), SHOP_PURCHASE_TIMEOUT_MS)
    })
    const query = supabase.rpc(name, params)
    const { data, error } = await Promise.race([
      issuance ? query : withAbortSignal(query, signal), interrupted,
    ])
    if (error) throw error
    return data
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

export async function listShopPurchases(organizationId, signal) {
  if (!uuid(organizationId)) throw new Error('Выберите организацию.')
  const data = await request('list_organization_shop_purchases', {
    p_organization_id: organizationId,
  }, signal)
  if (!Array.isArray(data) || data.some(item => !uuid(item.acquisition_id) || item.organization_id !== organizationId
    || !uuid(item.version_id) || typeof item.title !== 'string' || typeof item.version_label !== 'string'
    || typeof item.copy_available !== 'boolean' || (item.quest_id !== null && !uuid(item.quest_id)))) {
    throw new Error('Не удалось проверить список покупок. Повторите загрузку.')
  }
  return data
}

// Acquisition itself is the server idempotency key; retries never issue a second original.
export async function issueShopCopy(organizationId, acquisitionId, signal) {
  if (!uuid(organizationId) || !uuid(acquisitionId)) throw new Error('Не удалось определить покупку и организацию.')
  const data = await request('issue_shop_quest_copy', {
    p_organization_id: organizationId, p_acquisition_id: acquisitionId,
  }, signal, true)
  if (!uuid(data)) throw new Error('Не удалось подтвердить создание копии. Повторите запрос.')
  return data
}
