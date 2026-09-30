// @vitest-environment node
import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createSubscriptionSettlementOrderRuntime } from './subscriptionSettlementOrderRuntime.js'
const id = '11111111-1111-4111-8111-111111111111', token = 'ab'.repeat(32), timestamp = '1800000000'
function setup(overrides = {}) {
  const env = { YOOKASSA_SANDBOX_ENABLED: 'true', YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED: 'true',
    YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ID: id, YOOKASSA_SANDBOX_WORKER_TOKEN: token,
    SUPABASE_URL: 'https://jeugfyaqzfgdvfhdxfht.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    YOOKASSA_SANDBOX_SHOP_ID: '1467641', YOOKASSA_SANDBOX_SECRET_KEY: 'test-only', ...overrides }
  const rpc = vi.fn().mockResolvedValueOnce({ data: { action: 'reconcile', shopId: '1467641', requiresReview: true } })
  const client = vi.fn(() => ({ rpc }))
  const provider = vi.fn(() => ({}))
  return { client, rpc, provider, handler: createSubscriptionSettlementOrderRuntime(k => env[k], client, provider, () => Number(timestamp) * 1000) }
}
function request(purpose = 'qvesta-order-settlement-v1', orderId = id, time = timestamp) {
  const signature = createHmac('sha256', token).update(`${purpose}\n${orderId}\n${time}`).digest('hex')
  return new Request('https://example.test/settle', { method: 'POST', headers: {
    'x-qvesta-order-id': orderId, 'x-qvesta-order-timestamp': time, 'x-qvesta-order-signature': signature } })
}
it('accepts a signed exact-order request and preserves review state', async () => {
  const c = setup(), r = await c.handler(request())
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ state: 'review_required' })
  expect(c.rpc).toHaveBeenCalledWith('claim_scheduled_subscription_settlement', { p_order_id: id })
})
it.each([
  ['qvesta-order-reconcile-v1', id, timestamp, 401],
  ['qvesta-order-settlement-v1', '22222222-2222-4222-8222-222222222222', timestamp, 503],
  ['qvesta-order-settlement-v1', id, '1799999900', 401],
])('rejects wrong purpose/target/expiry', async (purpose, target, time, status) => {
  const c = setup(), r = await c.handler(request(purpose, target, time))
  expect(r.status).toBe(status)
  expect(r.headers.get('cache-control')).toBe('no-store')
  expect(c.client).not.toHaveBeenCalled()
})
it.each([
  { YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED: undefined },
  { YOOKASSA_SANDBOX_ENABLED: 'false' },
  { YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ID: '' },
  { SUPABASE_URL: 'https://production.example' },
  { YOOKASSA_SANDBOX_SHOP_ID: '999' },
  { SUPABASE_SERVICE_ROLE_KEY: '' },
])('fails closed on disabled or invalid configuration', async overrides => {
  const c = setup(overrides)
  expect((await c.handler(request())).status).toBe(503)
  expect(c.client).not.toHaveBeenCalled()
})
it('rejects anonymous requests before constructing clients', async () => {
  const c = setup()
  expect((await c.handler(new Request('https://example.test', { method: 'POST' }))).status).toBe(401)
  expect(c.client).not.toHaveBeenCalled()
})

it.each(['settlement_provider_mismatch', 'private response contact@example.test secret-value'])('logs only allowlisted error codes', async failure => {
  const c = setup()
  c.rpc.mockReset().mockRejectedValue(new Error(failure))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await c.handler(request())
    expect(response.status).toBe(503)
    expect(log).toHaveBeenCalledExactlyOnceWith('sandbox_settlement_failure', failure === 'settlement_provider_mismatch' ? failure : 'unclassified')
    expect(await response.text()).not.toContain(failure)
  } finally { log.mockRestore() }
})
