import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// One reviewed experiment, not an application checkout or a general payment API.
export const PROBE_ID = '65b56025-7260-40de-a54e-81a8d074f358'
export const JOURNAL_NAME = `receipt-probe-${PROBE_ID}-request`
const START = Date.parse('2026-09-27T22:00:00Z')
const END = Date.parse('2026-09-28T21:00:00Z')
const SHOP = '1467641'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = code => { throw new Error(code) }
function windowOpen(now) {
  if (!Number.isFinite(now) || now < START || now >= END) fail('probe_window_closed')
}
function configuration(config) {
  if (config.shopId !== SHOP || typeof config.secretKey !== 'string' || !/^[!-~]{16,}$/.test(config.secretKey)) fail('probe_configuration_invalid')
  if (typeof config.email !== 'string' || config.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) fail('probe_contact_invalid')
}
export function prepareProbe(config, now = Date.now()) {
  configuration(config)
  windowOpen(now)
  return {
    version: 1, probeId: PROBE_ID, shopId: SHOP, preparedAt: new Date(now).toISOString(),
    idempotencyKey: PROBE_ID,
    body: {
      amount: { value: '990.00', currency: 'RUB' }, capture: true,
      payment_method_data: { type: 'yoo_money' },
      confirmation: { type: 'redirect', return_url: 'https://stage.qvesta.ru/organization/billing' },
      description: 'Квеста: изолированный тест точности чека',
      metadata: { receipt_probe_id: PROBE_ID, environment: 'sandbox' },
      receipt: {
        customer: { email: config.email },
        items: [{ description: 'Тест точности частичного возврата услуги', quantity: '1.000',
          amount: { value: '990.00', currency: 'RUB' }, vat_code: 1,
          payment_subject: 'service', payment_mode: 'full_prepayment' }],
      },
    },
  }
}
function key(secret, salt) {
  return hkdfSync('sha256', secret, salt, 'qvesta-receipt-probe-journal-v1', 32)
}
export function sealProbe(plan, secret) {
  const salt = randomBytes(32), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret, salt), iv)
  cipher.setAAD(Buffer.from(JOURNAL_NAME))
  const data = Buffer.concat([cipher.update(JSON.stringify(plan), 'utf8'), cipher.final()])
  return JSON.stringify({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
}
export function openProbe(envelope, secret) {
  try {
    const value = JSON.parse(envelope)
    if (value.version !== 1) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', key(secret, Buffer.from(value.salt, 'base64')), Buffer.from(value.iv, 'base64'))
    decipher.setAAD(Buffer.from(JOURNAL_NAME))
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'))
  } catch { fail('probe_journal_invalid') }
}
export async function sendProbe(plan, config, { persisted = false, fetchImpl = fetch, now = Date.now } = {}) {
  configuration(config)
  windowOpen(now())
  const prepared = Date.parse(plan?.preparedAt)
  if (!persisted || !Number.isFinite(prepared) || prepared > now()
    || JSON.stringify(plan) !== JSON.stringify(prepareProbe(config, prepared))) fail('probe_journal_mismatch')
  const headers = { Authorization: `Basic ${Buffer.from(`${SHOP}:${config.secretKey}`).toString('base64')}` }
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`https://api.yookassa.ru/v3/${path}`, {
      ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error()
    return response.json()
  }
  // Failure before POST is distinct from an unknown result after attempting POST.
  try {
    const shop = await request('me')
    if (shop.account_id !== SHOP || shop.test !== true || shop.status !== 'enabled') throw new Error()
  } catch { fail('probe_shop_unverified') }
  windowOpen(now())
  try {
    const payment = await request('payments', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotence-Key': plan.idempotencyKey }, body: JSON.stringify(plan.body) })
    if (!uuid.test(payment.id) || payment.test !== true || payment.recipient?.account_id !== SHOP
      || payment.amount?.value !== '990.00' || payment.amount?.currency !== 'RUB'
      || payment.metadata?.receipt_probe_id !== PROBE_ID || payment.metadata?.environment !== 'sandbox'
      || !['pending', 'succeeded', 'canceled'].includes(payment.status) || typeof payment.paid !== 'boolean'
      || (payment.status === 'succeeded' && !payment.paid)) throw new Error()
    let confirmationUrl = null
    if (payment.confirmation) {
      const url = new URL(payment.confirmation.confirmation_url)
      if (payment.confirmation.type !== 'redirect' || url.protocol !== 'https:' || url.port || url.username || url.password
        || !['yoomoney.ru', 'yookassa.ru'].includes(url.hostname)) throw new Error()
      confirmationUrl = url.href
    }
    return { outcome: 'identified', probeId: PROBE_ID, paymentId: payment.id, status: payment.status,
      paid: payment.paid, test: true, confirmationUrl,
      receiptRegistration: ['pending', 'succeeded', 'canceled'].includes(payment.receipt_registration) ? payment.receipt_registration : 'unknown' }
  } catch { return { outcome: 'unknown', probeId: PROBE_ID } }
}
