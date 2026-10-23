// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runSandboxSettlementPhase } from './sandboxSettlementPhase.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
const id = '11111111-1111-4111-8111-111111111111'
const line = { description: 'Subscription', quantity: '1.000', amount: { value: '990.00', currency: 'RUB' }, vat_code: 1, payment_subject: 'service', payment_mode: 'full_payment' }
function setup({ timeout = false, matches = 1, wrongShop = false } = {}) {
  let saved = null, providerCreated = false
  const body = { type: 'payment', payment_id: id, send: true, customer: { email: 'buyer@example.test' }, items: [line], settlements: [{ type: 'prepayment', amount: line.amount }] }
  const receipt = { id: 'rt-created', type: 'payment', payment_id: id, status: 'succeeded', items: [line] }
  const fetchImpl = vi.fn(async (url, options) => {
    const path = new URL(url).pathname
    let result
    if (path.endsWith('/me')) result = { account_id: wrongShop ? '999' : '123', test: true, status: 'enabled' }
    else if (path.endsWith('/payments/' + id)) result = { id, test: true, status: 'succeeded', paid: true, recipient: { account_id: '123' }, amount: line.amount, refunded_amount: { value: '0.00', currency: 'RUB' } }
    else if (path.endsWith('/receipts') && options.method === 'POST') {
      providerCreated = true
      if (timeout) throw Error('simulated timeout')
      result = { ...receipt, status: 'pending' }
    } else if (path.endsWith('/receipts')) result = { items: providerCreated ? Array.from({ length: matches }, (_, i) => ({ ...receipt, id: 'rt-found-' + i })) : [] }
    else if (path.endsWith('/receipts/rt-created')) result = receipt
    else throw Error('unexpected mock URL')
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const rpc = vi.fn(async (name, args) => {
    if (name === 'list_pending_prepayment_settlements') return { data: saved && saved.status !== 'succeeded' ? [{ orderId: id, ...saved }] : [] }
    if (name === 'list_due_subscription_settlements') return { data: saved ? [] : [{ orderId: id, shopId: '123', dueAt: '2026-09-27T00:00:00Z' }] }
    if (name === 'claim_prepayment_settlement') {
      if (saved) return { data: { ...saved, action: 'reconcile' } }
      saved = { body, key: id, shopId: '123', firstSentAt: '2026-09-27T00:00:01Z', receiptId: null, status: 'unknown' }
      return { data: { ...saved, action: 'send' } }
    }
    if (name === 'record_prepayment_settlement') { saved.receiptId = args.p_receipt_id; saved.status = args.p_status; return { error: null } }
    if (name === 'record_settlement_poll') return { error: null }
    throw Error('unexpected mock RPC')
  })
  const createProvider = vi.fn(() => createSandboxHttpClient({ enabled: true, shopId: '123', secretKey: 'synthetic-test-value' }, { fetchImpl, now: () => Date.parse('2026-09-27T00:00:02Z') }))
  return { rpc, createProvider, shopId: '123', fetchImpl, body }
}
it.each([{}, { dispatchEnabled: true }, { reconciliationEnabled: 'true', dispatchEnabled: true }])('stays closed unless reconciliation is explicitly enabled: %j', async flags => {
  const ctx = setup()
  expect(await runSandboxSettlementPhase({ ...ctx, ...flags })).toEqual({ settlements: null, dueSettlements: null })
  expect(ctx.rpc).not.toHaveBeenCalled()
  expect(ctx.createProvider).not.toHaveBeenCalled()
})
it('reconciliation alone never discovers new work or sends HTTP', async () => {
  const ctx = setup()
  expect(await runSandboxSettlementPhase({ ...ctx, reconciliationEnabled: true })).toMatchObject({ dueSettlements: null })
  expect(ctx.rpc.mock.calls.map(x => x[0])).toEqual(['list_pending_prepayment_settlements'])
  expect(ctx.fetchImpl).not.toHaveBeenCalled()
})
it('sends the exact persisted body/key once, then recovers with GET on restart', async () => {
  const ctx = setup()
  const flags = { reconciliationEnabled: true, dispatchEnabled: true }
  expect(await runSandboxSettlementPhase({ ...ctx, ...flags })).toMatchObject({ dueSettlements: { processed: 1, failed: 0 } })
  expect(await runSandboxSettlementPhase({ ...ctx, ...flags })).toMatchObject({ settlements: { checked: 1 }, dueSettlements: { processed: 0 } })
  const posts = ctx.fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0][0]).toBe('https://api.yookassa.ru/v3/receipts')
  expect(JSON.parse(posts[0][1].body)).toEqual(ctx.body)
  expect(posts[0][1].headers['Idempotence-Key']).toBe(id)
  expect(ctx.fetchImpl.mock.calls.some(([url]) => url.endsWith('/receipts/rt-created'))).toBe(true)
})
it.each([0, 1, 2])('after timeout searches %s matches without another POST', async matches => {
  const ctx = setup({ timeout: true, matches })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const flags = { reconciliationEnabled: true, dispatchEnabled: true }
    expect(await runSandboxSettlementPhase({ ...ctx, ...flags })).toMatchObject({ dueSettlements: { failed: 1 } })
    const result = await runSandboxSettlementPhase({ ...ctx, ...flags })
    expect(result.settlements).toMatchObject(matches === 0 ? { unresolved: 1 } : matches === 1 ? { checked: 1 } : { failed: 1 })
    expect(result.dueSettlements.processed).toBe(0)
    expect(ctx.fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  } finally { log.mockRestore() }
})
it('wrong provider account prevents POST after claim', async () => {
  const ctx = setup({ wrongShop: true })
  expect(await runSandboxSettlementPhase({ ...ctx, reconciliationEnabled: true, dispatchEnabled: true })).toMatchObject({ dueSettlements: { failed: 1 } })
  expect(ctx.fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0)
})
it('storage failure during recovery prevents starting new dispatch work', async () => {
  const ctx = setup()
  ctx.rpc.mockResolvedValueOnce({ error: { code: 'storage' } })
  await expect(runSandboxSettlementPhase({ ...ctx, reconciliationEnabled: true, dispatchEnabled: true })).rejects.toThrow()
  expect(ctx.rpc).toHaveBeenCalledTimes(1)
  expect(ctx.fetchImpl).not.toHaveBeenCalled()
})
