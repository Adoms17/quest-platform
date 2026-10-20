// Shop-only transport. POST is never payment authority; only a bound GET can
// produce a verified fact. No subscription, recurring, refund or fiscal imports.
import { yookassaHttpRequest } from './yookassaHttpRequest.js'
const API = 'https://api.yookassa.ru/v3/payments'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RETRY_AGE = 23 * 60 * 60 * 1000
export class ShopPaymentError extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = code => { throw new ShopPaymentError(code) }
const object = x => x && typeof x === 'object' && !Array.isArray(x)
const canonical = x => JSON.stringify(Array.isArray(x) ? x.map(v => JSON.parse(canonical(v))) : object(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, JSON.parse(canonical(x[k]))])) : x)
const equal = (a, b) => canonical(a) === canonical(b)
export async function shopBodyHash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}
export function validateShopConfirmationUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['yoomoney.ru', 'yookassa.ru'].includes(url.hostname)
      || url.username || url.password || url.port || url.hash) fail('invalid_confirmation_url')
    return url.href
  } catch { fail('invalid_confirmation_url') }
}
function validateConfig(options) {
  const c = options.config
  if (!c || c.enabled !== true || c.approved !== true || !/^\d+$/.test(c.merchant)
    || !['sandbox', 'production'].includes(c.environment) || typeof c.secretKey !== 'string'
    || !/^[\x21-\x7e]+$/.test(c.secretKey)) fail('configuration_unavailable')
  let origin
  try { origin = new URL(c.returnOrigin) } catch { fail('configuration_unavailable') }
  if (origin.protocol !== 'https:' || origin.origin !== c.returnOrigin || origin.username || origin.password)
    fail('configuration_unavailable')
  const timeout = options.timeoutMs ?? 15000
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 15000) fail('configuration_unavailable')
  return c
}
function validateContext(ctx, orderId, options) {
  const config = validateConfig(options), c = ctx?.contract, b = ctx?.request_body, s = ctx?.snapshot
  if (ctx?.order_id !== orderId || !object(s) || !/^[a-f0-9]{64}$/.test(ctx.snapshot_hash ?? '')
    || c?.contract_version !== 'shop-payment-v1' || c.approved !== true || c.provider !== 'yookassa'
    || c.merchant !== config.merchant || c.environment !== config.environment || c.return_origin !== config.returnOrigin
    || c.capture !== true || typeof c.test_only !== 'boolean'
    || (c.test_only && !(options.testOnlyTransport === true && typeof options.fetchImpl === 'function' && options.fetchImpl !== globalThis.fetch)))
    fail('contract_unavailable')
  const r = c.receipt
  if (!object(r) || !object(r.customer) || (!r.customer.email && !r.customer.phone)
    || !Array.isArray(r.items) || !r.items.length || r.items.some(i => !i.description
      || !/^\d+(\.\d{1,3})?$/.test(String(i.quantity)) || Number(i.quantity) <= 0
      || !Number.isInteger(i.vat_code) || i.vat_code < 1 || i.vat_code > 12
      || !i.payment_subject || !i.payment_mode || !i.amount?.value || !i.amount?.currency)) fail('receipt_unavailable')
  const metadata = { order_id: orderId, organization_id: s.organization_id, version_id: s.version_id,
    offer_id: s.offer_id, contract_version: c.contract_version, snapshot_hash: ctx.snapshot_hash, environment: c.environment }
  if (!object(b) || !Number.isSafeInteger(s.amount_minor) || s.amount_minor <= 0 || !/^[A-Z]{3}$/.test(s.currency)
    || !equal(b.amount, { value: `${Math.floor(s.amount_minor / 100)}.${String(s.amount_minor % 100).padStart(2, '0')}`, currency: s.currency }) || b.capture !== true
    || !equal(b.confirmation, { type: 'redirect', return_url: `${config.returnOrigin}/organization/shop/orders/${orderId}` })
    || !equal(b.metadata, metadata) || !equal(b.receipt, r) || typeof b.description !== 'string' || !b.description.trim())
    fail('request_mismatch')
  return ctx
}
function validatePayment(payment, ctx, expectedId) {
  if (!UUID.test(payment?.id ?? '') || (expectedId && payment.id !== expectedId)
    || payment.recipient?.account_id !== ctx.contract.merchant || payment.test !== (ctx.contract.environment === 'sandbox')
    || !equal(payment.amount, ctx.request_body.amount) || !equal(payment.metadata, ctx.request_body.metadata)
    || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(payment.status)
    || typeof payment.paid !== 'boolean' || (payment.status === 'succeeded' && payment.paid !== true)) fail('payment_mismatch')
  if (payment.confirmation?.confirmation_url) validateShopConfirmationUrl(payment.confirmation.confirmation_url)
  return payment
}
async function rpc(options, name, args) {
  const result = await options.rpc(name, args)
  if (result?.error || !result || !Object.hasOwn(result, 'data')) fail('storage_unavailable')
  return result.data
}
async function context(orderId, options) {
  if (!UUID.test(orderId ?? '')) fail('invalid_order_id')
  validateConfig(options)
  return validateContext(await rpc(options, 'read_shop_payment_context', { p_order_id: orderId, p_actor_id: options.actorId ?? null }), orderId, options)
}
async function request(options, method, path, attempt) {
  const c = validateConfig(options)
  try {
    return await yookassaHttpRequest(path, { method,
      headers: { Authorization: `Basic ${btoa(`${c.merchant}:${c.secretKey}`)}`,
        ...(attempt ? { 'Content-Type': 'application/json', 'Idempotence-Key': attempt.idempotency_key } : {}) },
      ...(attempt ? { body: attempt.body_text } : {}) }, {
      fetchImpl: options.fetchImpl ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 15000,
      readResponse: async response => {
        if (!response.ok) fail('provider_request_failed')
        return await response.json()
      },
    })
  } catch { fail(method === 'POST' ? 'payment_outcome_unknown' : 'provider_read_failed') }
}
async function reconcileContext(ctx, options) {
  const a = ctx.attempt
  if (!a?.provider_payment_id) return { orderId: ctx.order_id, status: 'pending' }
  if (!UUID.test(a.provider_payment_id)) fail('payment_mismatch')
  const payment = validatePayment(await request(options, 'GET', `${API}/${a.provider_payment_id}`), ctx, a.provider_payment_id)
  const recorded = await rpc(options, 'record_shop_verified_payment', { p_attempt_id: a.id, p_payment: payment })
  if (!recorded || !['confirmed', 'not_paid'].includes(recorded.status)
    || !(recorded.fact_id === null || UUID.test(recorded.fact_id ?? ''))
    || (recorded.status === 'confirmed' && !UUID.test(recorded.fact_id ?? ''))) fail('storage_response_invalid')
  return { orderId: ctx.order_id, status: recorded.status === 'confirmed' ? 'confirmed' : 'pending',
    ...(recorded.status !== 'confirmed' && payment.status === 'pending' && payment.confirmation?.confirmation_url
      ? { confirmationUrl: validateShopConfirmationUrl(payment.confirmation.confirmation_url) } : {}) }
}
export async function reconcileShopPayment(orderId, options) { return reconcileContext(await context(orderId, options), options) }
export async function runShopCheckout(orderId, options) {
  if (!UUID.test(options.actorId ?? '')) fail('actor_required')
  let ctx = await context(orderId, options)
  if (ctx.attempt?.provider_payment_id) return reconcileContext(ctx, options)
  const result = await rpc(options, 'begin_shop_payment_attempt', { p_order_id: orderId, p_actor_id: options.actorId, p_body: ctx.request_body })
  const a = result?.attempt
  if (typeof result?.can_send !== 'boolean') fail('storage_response_invalid')
  if (!result.can_send) {
    if (result.reason === 'paid') return { orderId, status: 'confirmed' }
    if (result.reason === 'busy') return { orderId, status: 'pending' }
    if (result.reason === 'reconcile_required') fail('payment_reconciliation_required')
    if (result.reason === 'identified') {
      const current = await context(orderId, options)
      if (!current.attempt?.provider_payment_id) fail('storage_response_invalid')
      return reconcileContext(current, options)
    }
    fail('storage_response_invalid')
  }
  if (!a || !UUID.test(a.id) || !UUID.test(a.lease_token) || typeof a.idempotency_key !== 'string'
    || !/^[\x21-\x7e]{1,64}$/.test(a.idempotency_key) || typeof a.body_text !== 'string'
    || await shopBodyHash(a.body_text) !== a.body_hash || a.snapshot_hash !== ctx.snapshot_hash) fail('attempt_mismatch')
  let saved
  try { saved = JSON.parse(a.body_text) } catch { fail('attempt_mismatch') }
  if (!equal(saved, ctx.request_body)) fail('attempt_mismatch')
  const age = (options.now ?? Date.now)() - Date.parse(a.first_sent_at)
  if (!Number.isFinite(age) || age < 0 || age >= MAX_RETRY_AGE) fail('attempt_expired')
  try {
    const payment = validatePayment(await request(options, 'POST', API, a), ctx)
    await rpc(options, 'record_shop_checkout_payment', { p_attempt_id: a.id, p_lease_token: a.lease_token, p_payment: payment })
  } catch {
    // A lost storage response may have committed. Re-read before classifying;
    // never allocate a replacement key or infer payment from the POST response.
    try {
      ctx = await context(orderId, options)
      if (ctx.attempt?.provider_payment_id) return await reconcileContext(ctx, options)
    } catch { /* preserve the unknown outcome without leaking transport data */ }
    try { await rpc(options, 'mark_shop_payment_unknown', { p_attempt_id: a.id, p_lease_token: a.lease_token }) } catch { /* lease expiry permits recovery */ }
    fail('payment_outcome_unknown')
  }
  return reconcileContext(await context(orderId, options), options)
}

// Bound actual bytes and total read time, independent of Content-Length.
// Cancellation must not extend the deadline if the upstream cancel hook stalls.
async function readShopRequestBody(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_request')
  let timer
  try {
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('invalid_request')), 5000)
    })
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let bytes = 0, text = ''
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout])
      if (done) break
      bytes += value.byteLength
      if (bytes > 1024) throw new Error('invalid_request')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } catch (error) {
    try { void reader.cancel().catch(() => {}) } catch { /* preserve safe rejection */ }
    throw error
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

export async function handleShopPaymentRequest(request, options) {
  const origin = request.headers.get('origin')
  const allowed = origin && origin === options.config?.returnOrigin
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}) }
  const reply = (status, value) => new Response(JSON.stringify(value), { status, headers })
  if (origin && !allowed) return reply(403, { error: 'origin_denied' })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' })
  try {
    validateConfig(options)
    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'authentication_required' })
    const actorId = await options.authenticate(authorization.slice(7))
    if (!UUID.test(actorId ?? '')) return reply(401, { error: 'authentication_required' })
    let body
    try { body = await readShopRequestBody(request) } catch { return reply(400, { error: 'invalid_request' }) }
    const availability = body?.action === 'availability' && options.mode === 'checkout'
    if (!object(body) || Object.keys(body).length !== (availability ? 2 : 1) || !UUID.test(body.orderId ?? '')) return reply(400, { error: 'invalid_request' })
    // Read-only capability probe: validate the same runtime, actor and immutable
    // contract as checkout without creating an attempt or contacting the provider.
    if (availability) {
      await context(body.orderId, { ...options, actorId })
      return reply(200, { orderId: body.orderId, status: 'available' })
    }
    const execute = options.mode === 'reconcile' ? reconcileShopPayment : runShopCheckout
    return reply(200, await execute(body.orderId, { ...options, actorId }))
  } catch (error) {
    const code = error instanceof ShopPaymentError ? error.code : 'request_unavailable'
    return reply(503, { error: code })
  }
}
