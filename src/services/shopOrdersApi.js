import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const nullableId = value => value === null || uuid(value)
const text = value => typeof value === 'string' && value.trim().length > 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () => new Error('Не удалось проверить данные заказа. Обновите страницу.')
function ids(...values) { if (!values.every(uuid)) throw invalid() }
function snapshot(s, org) {
  return object(s) && s.organization_id === org && ['organization_id', 'product_id', 'version_id', 'offer_id'].every(k => uuid(s[k]))
    && ['organization_name', 'product_title', 'version_label', 'price_version', 'terms_id'].every(k => text(s[k]))
    && Number.isSafeInteger(s.amount_minor) && s.amount_minor > 0 && /^[A-Z]{3}$/.test(s.currency) && object(s.terms)
}
function order(data, org) {
  if (!object(data) || !uuid(data.id) || !snapshot(data.snapshot, org)
    || !['unconfirmed', 'succeeded'].includes(data.paid_state)
    || !['pending', 'entitled', 'copied', 'complete'].includes(data.fulfillment_state)
    || !nullableId(data.acquisition_id) || !nullableId(data.quest_id) || typeof data.copy_available !== 'boolean'
    || !(data.fulfillment_error === null || /^[A-Z0-9]{5}$/.test(data.fulfillment_error))
    || (data.fulfillment_state !== 'pending' && (data.paid_state !== 'succeeded' || !uuid(data.acquisition_id)))
    || (['copied', 'complete'].includes(data.fulfillment_state) && !uuid(data.quest_id))
    || (data.copy_available && !uuid(data.quest_id))) throw invalid()
  return data
}
async function rpc(name, params, signal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  let timeout, cancel
  try {
    const interrupted = new Promise((_, reject) => {
      cancel = () => reject(new DOMException('Request canceled', 'AbortError'))
      controller.signal.addEventListener('abort', cancel, { once: true })
      if (controller.signal.aborted) cancel()
      timeout = setTimeout(() => controller.abort(), 15000)
    })
    if (controller.signal.aborted) return await interrupted
    const { data, error } = await Promise.race([withAbortSignal(supabase.rpc(name, params), controller.signal), interrupted])
    if (error) throw error
    return data
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', cancel)
  }
}

export async function readShopOffer(organizationId, offerId, signal) {
  ids(organizationId, offerId)
  const data = await rpc('read_shop_offer', { p_organization_id: organizationId, p_offer_id: offerId }, signal)
  if (!object(data) || !snapshot(data.snapshot, organizationId) || data.snapshot.offer_id !== offerId
    || typeof data.sales_enabled !== 'boolean' || !nullableId(data.existing_order_id) || !nullableId(data.existing_acquisition_id)) throw invalid()
  return data
}

export async function createShopOrder(organizationId, offerId, operationId) {
  ids(organizationId, offerId, operationId)
  const data = await rpc('create_shop_order', {
    p_organization_id: organizationId, p_offer_id: offerId, p_operation_id: operationId,
  })
  if (!uuid(data)) throw invalid()
  return data
}

export async function readShopOrder(orderId, organizationId, signal) {
  ids(orderId, organizationId)
  const data = order(await rpc('read_shop_order', { p_order_id: orderId }, signal), organizationId)
  if (data.id !== orderId) throw invalid()
  return data
}

export async function listShopOrders(organizationId, signal) {
  ids(organizationId)
  const data = await rpc('list_organization_shop_orders', { p_organization_id: organizationId }, signal)
  if (!Array.isArray(data)) throw invalid()
  return data.map(item => order(item, organizationId))
}
