import { supabase } from '../supabaseClient'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uncertain = () => new Error('Состояние заказа не подтверждено. Восстановите этот заказ перед новой покупкой.')
function key(actor, org) {
 if (!uuid.test(actor) || !uuid.test(org)) throw uncertain()
 return 'discount-checkout-command:' + actor + ':' + org
}
export function readDiscountCommand(actor, org) {
 const id = localStorage.getItem(key(actor, org))
 if (id !== null && !uuid.test(id)) throw uncertain()
 return id
}
async function rpc(name, args) {
 let response
 try { response = await supabase.rpc(name, args) } catch { throw uncertain() }
 if (response?.error || response?.data === undefined) throw uncertain()
 return response.data
}
function validateOrder(data, org) {
 if (!data || data.organization_id !== org || !uuid.test(data.order_id) || !uuid.test(data.offer_id)
  || !uuid.test(data.plan_version_id) || data.environment !== 'sandbox' || data.currency !== 'RUB'
  || !['ready','executing','completed','cancelled'].includes(data.state)
  || !['reserved','consumed','released'].includes(data.reservation_state)
  || typeof data.payment_requires_review !== 'boolean'
  || (data.payment_order_id !== null && data.payment_order_id !== data.order_id)
  || (data.payment_status !== null && !['pending','waiting_for_capture','succeeded','canceled'].includes(data.payment_status))
  || ![data.base_amount_minor,data.discount_amount_minor,data.amount_minor].every(n => Number.isSafeInteger(n) && n >= 0)
  || data.base_amount_minor - data.discount_amount_minor !== data.amount_minor
  || data.requires_payment !== (data.amount_minor > 0)) throw uncertain()
 return data
}
export async function recoverDiscountCheckout(actor, org) {
 const commandId = readDiscountCommand(actor, org)
 if (!commandId) return { commandId: null, order: null }
 const data = await rpc('recover_sandbox_discount_checkout', { p_organization_id: org, p_command_id: commandId })
 if (readDiscountCommand(actor, org) !== commandId) throw uncertain()
 // null не доказывает отказ: первоначальный запрос может ещё выполняться.
 return { commandId, order: data === null ? null : validateOrder(data, org) }
}
export async function acceptDiscountCheckout(actor, org, offerId, code, quote) {
 if (!uuid.test(offerId) || !quote || quote.organization_id !== org || quote.offer_id !== offerId
  || typeof code !== 'string' || code.length > 128) throw uncertain()
 let commandId = readDiscountCommand(actor, org)
 if (commandId) {
  const restored = await recoverDiscountCheckout(actor, org)
  if (restored.order) return restored
 } else {
  commandId = crypto.randomUUID()
  localStorage.setItem(key(actor, org), commandId)
 }
 if (readDiscountCommand(actor, org) !== commandId) throw uncertain()
 const data = await rpc('accept_sandbox_discount_checkout', { p_organization_id: org, p_offer_id: offerId, p_command_id: commandId, p_code: code.trim(), p_reviewed_quote: quote })
 if (readDiscountCommand(actor, org) !== commandId) throw uncertain()
 if (data?.ok === false && ['invalid_code','rate_limited','offer_unavailable','trial_period_already_paid','discount_exhausted','checkout_pending','quote_changed'].includes(data.reason)) return { commandId, order: null, reason: data.reason }
 if (data?.ok !== true || !uuid.test(data.order_id)) throw uncertain()
 const restored = await recoverDiscountCheckout(actor, org)
 if (restored.order?.order_id !== data.order_id) throw uncertain()
 return restored
}
async function actOnOrder(actor, org, orderId, name) {
 const restored = await recoverDiscountCheckout(actor, org)
 if (!uuid.test(orderId) || restored.order?.order_id !== orderId) throw uncertain()
 await rpc(name, { p_organization_id: org, p_order_id: orderId })
 if (readDiscountCommand(actor, org) !== restored.commandId) throw uncertain()
 const result = await recoverDiscountCheckout(actor, org)
 if (result.order?.order_id !== orderId) throw uncertain()
 return result
}
export const executeDiscountCheckout = (actor, org, orderId) => actOnOrder(actor, org, orderId, 'execute_sandbox_discount_checkout')
export const cancelDiscountCheckout = (actor, org, orderId) => actOnOrder(actor, org, orderId, 'cancel_sandbox_discount_checkout')

export async function dismissDiscountCheckout(actor, org) {
 const restored = await recoverDiscountCheckout(actor, org)
 if (!restored.order || !['completed','cancelled'].includes(restored.order.state) || restored.order.payment_requires_review) throw uncertain()
 if (readDiscountCommand(actor, org) !== restored.commandId) throw uncertain()
 localStorage.removeItem(key(actor, org))
}
