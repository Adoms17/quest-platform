import { supabase } from '../supabaseClient'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const key = (actor, org) => {
  if (!uuid.test(actor) || !uuid.test(org)) throw new Error('Не определена организация для оплаты.')
  return `sandbox-checkout:${actor}:${org}`
}
const uncertain = () => new Error('Не удалось подтвердить состояние тестового платежа. Повторите проверку этого заказа.')

export async function recoverSandboxCheckout(actor, org) {
  const saved = readSandboxCheckout(actor, org)
  if (saved) return saved
  if (readOfferCommand(actor, org)) return reserveSandboxOffer(actor, org)
  const { data, error } = await supabase.rpc('find_pending_sandbox_order', { p_organization_id: org })
  if (error || (data !== null && !uuid.test(data))) throw uncertain()
  // Другая вкладка могла сохранить заказ за время ожидания.
  if (data !== null) rememberSandboxCheckout(actor, org, data)
  return readSandboxCheckout(actor, org)
}

const commandKey = (actor, org) => `${key(actor, org)}:offer-command`
function readOfferCommand(actor, org) {
  const raw = localStorage.getItem(commandKey(actor, org))
  if (!raw) return null
  let command
  try { command = JSON.parse(raw) } catch { throw uncertain() }
  if (!command || Object.keys(command).length !== 3 || command.p_organization_id !== org || !uuid.test(command.p_offer_id) || !uuid.test(command.p_command_id)) throw uncertain()
  return command
}
export async function listSandboxOffers(org) {
  if (!uuid.test(org)) throw uncertain()
  const { data, error } = await supabase.rpc('list_sandbox_checkout_offers', { p_organization_id: org })
  if (error || !Array.isArray(data) || data.length > 20 || !data.every(offer =>
    uuid.test(offer.offer_id) && offer.organization_id === org && offer.environment === 'sandbox'
    && uuid.test(offer.plan_version_id) && typeof offer.plan_name === 'string' && offer.plan_name.trim()
    && Number.isSafeInteger(offer.amount_minor) && offer.amount_minor > 0 && offer.currency === 'RUB'
    && Number.isFinite(Date.parse(offer.valid_until)) && Number.isFinite(Date.parse(offer.period_start))
    && Number.isFinite(Date.parse(offer.period_end)) && Date.parse(offer.period_end) > Date.parse(offer.period_start))) throw uncertain()
  return data
}
export async function reserveSandboxOffer(actor, org, offerId) {
  const saved = readSandboxCheckout(actor, org)
  if (saved) return saved
  let command = readOfferCommand(actor, org)
  if (command && offerId && command.p_offer_id !== offerId) throw uncertain()
  if (!command) {
    if (!uuid.test(offerId)) throw uncertain()
    command = { p_organization_id: org, p_offer_id: offerId, p_command_id: crypto.randomUUID() }
    localStorage.setItem(commandKey(actor, org), JSON.stringify(command))
  }
  const { data, error } = await supabase.rpc('accept_sandbox_checkout_offer', command)
  if (error) {
    if (['22023', '42501', '40001', 'P0001'].includes(error.code)
      && localStorage.getItem(commandKey(actor, org)) === JSON.stringify(command)) localStorage.removeItem(commandKey(actor, org))
    throw uncertain()
  }
  if (!uuid.test(data)) throw uncertain()
  rememberSandboxCheckout(actor, org, data)
  if (localStorage.getItem(commandKey(actor, org)) === JSON.stringify(command)) localStorage.removeItem(commandKey(actor, org))
  return data
}

export async function dismissCanceledSandboxCheckout(actor, org) {
  const orderId = readSandboxCheckout(actor, org)
  const offer = await loadSandboxOffer(org, orderId)
  if (offer.state !== 'finished' || offer.payment_requires_review || readSandboxCheckout(actor, org) !== orderId) throw uncertain()
  localStorage.removeItem(key(actor, org))
}
export async function cancelUnsentSandboxCheckout(actor, org) {
  const orderId = readSandboxCheckout(actor, org)
  if (!orderId) throw uncertain()
  const { error } = await supabase.rpc('cancel_unsent_sandbox_order', { p_organization_id: org, p_order_id: orderId })
  if (error) throw uncertain()
  await dismissCanceledSandboxCheckout(actor, org)
}

export async function loadSandboxOffer(org, orderId) {
  if (!uuid.test(org) || !uuid.test(orderId)) throw uncertain()
  const { data, error } = await supabase.rpc('get_sandbox_order_offer', { p_organization_id: org, p_order_id: orderId })
  if (error || data?.organization_id !== org || data.order_id !== orderId || data.environment !== 'sandbox'
    || !uuid.test(data.plan_version_id) || typeof data.plan_name !== 'string' || !data.plan_name.trim()
    || !Number.isSafeInteger(data.amount_minor) || data.amount_minor <= 0 || data.currency !== 'RUB'
    || !Number.isFinite(Date.parse(data.period_start)) || !Number.isFinite(Date.parse(data.period_end))
    || Date.parse(data.period_end) <= Date.parse(data.period_start)
    || !['reserved', 'sending', 'review', 'finished'].includes(data.state)
    || (data.fulfillment_state !== undefined && !['none','not_paid','applied','deferred','review'].includes(data.fulfillment_state))
    || (data.payment_status != null && !['pending','waiting_for_capture','succeeded','canceled'].includes(data.payment_status))
    || (data.payment_requires_review !== undefined && typeof data.payment_requires_review !== 'boolean')
    || (data.refund_requires_review !== undefined && typeof data.refund_requires_review !== 'boolean')
    || ['refunded_minor','refund_pending_minor'].some(field => data[field] !== undefined && (!Number.isSafeInteger(data[field]) || data[field] < 0 || data[field] > data.amount_minor))) throw uncertain()
  return data
}

// Здесь хранится только ссылка на серверный заказ, без суммы, JWT или ключей.
export function readSandboxCheckout(actor, org) {
  const orderId = localStorage.getItem(key(actor, org))
  if (orderId !== null && !uuid.test(orderId)) throw uncertain()
  return orderId
}
export function rememberSandboxCheckout(actor, org, orderId) {
  if (!uuid.test(orderId)) throw uncertain()
  const current = readSandboxCheckout(actor, org)
  if (current && current !== orderId) throw new Error('Сначала проверьте предыдущий тестовый заказ.')
  localStorage.setItem(key(actor, org), orderId)
}
export async function checkSandboxCheckout(actor, org) {
  const orderId = readSandboxCheckout(actor, org)
  if (!orderId) throw new Error('Нет сохранённого тестового заказа.')
  let response
  try { response = await supabase.functions.invoke('sandbox-checkout', { body: { orderId } }) }
  catch { throw uncertain() }
  const { data, error } = response ?? {}
  if (error || data?.orderId !== orderId || !uuid.test(data.paymentId)
    || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(data.status)
    || typeof data.requiresReview !== 'boolean') throw uncertain()
  let confirmationUrl = null
  if (data.confirmationUrl !== null) {
    let url
    try { url = new URL(data.confirmationUrl) } catch { throw uncertain() }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['yoomoney.ru', 'yookassa.ru'].includes(url.hostname)
      || data.status !== 'pending' || data.requiresReview) throw uncertain()
    confirmationUrl = url.href
  }
  // Даже succeeded не является подтверждением выдачи подписки.
  // Не забываем заказ автоматически: при смене вкладки нужен тот же ID.
  return { orderId, paymentId: data.paymentId, status: data.status, requiresReview: data.requiresReview, confirmationUrl }
}
