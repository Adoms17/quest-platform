// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { processDueSubscriptionSettlements } from './subscriptionSettlementQueue.js'
import { reconcilePrepaymentSettlements } from './settlementReconciliation.js'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const item = id => ({ orderId: id, shopId: '123', dueAt: '2026-09-27T00:00:00Z' })
// Durable-state fake models the SQL claim contract already tested by concurrent
// PostgreSQL sessions. A new worker invocation shares storage, not local memory.
function setup(ids = [first]) {
  const claims = new Map()
  const provider = {
    createSettlement: vi.fn(async op => ({ id: 'rt-' + op.key, status: 'pending' })),
    readSettlement: vi.fn(async op => ({ id: op.receiptId, status: 'succeeded' })),
    findSettlement: vi.fn(async () => null),
  }
  const rpc = vi.fn(async (name, args) => {
    if (name === 'list_due_subscription_settlements') return { data: ids.filter(id => !claims.has(id)).map(item) }
    if (name === 'claim_prepayment_settlement') {
      const id = args.p_order_id
      if (claims.has(id)) return { data: { action: 'reconcile', ...claims.get(id) } }
      const op = { shopId: '123', body: { type: 'payment' }, key: id, firstSentAt: '2026-09-27T00:00:01Z' }
      claims.set(id, { ...op, receiptId: null, status: 'unknown' })
      return { data: { action: 'send', ...op } }
    }
    if (name === 'record_prepayment_settlement') {
      Object.assign(claims.get(args.p_order_id), { receiptId: args.p_receipt_id, status: args.p_status })
      return { error: null }
    }
    if (name === 'list_pending_prepayment_settlements') return { data: [...claims].map(([orderId, op]) => ({ orderId, ...op })) }
    if (name === 'record_settlement_poll') return { error: null }
    throw Error('unexpected RPC')
  })
  return { enabled: true, shopId: '123', provider, rpc, claims }
}
it.each([undefined, false, 'true'])('is disabled without explicit boolean opt-in: %s', async enabled => {
  const ctx = setup()
  expect(await processDueSubscriptionSettlements({ ...ctx, enabled })).toEqual({ state: 'disabled', processed: 0, failed: 0, reviewRequired: 0 })
  expect(ctx.rpc).not.toHaveBeenCalled()
  expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it('processes once and a new run does not rediscover a consumed claim', async () => {
  const ctx = setup()
  expect(await processDueSubscriptionSettlements(ctx)).toMatchObject({ processed: 1, failed: 0 })
  expect(await processDueSubscriptionSettlements(ctx)).toMatchObject({ processed: 0, failed: 0 })
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
})
it.each([null, { ...item(second), shopId: '999' }, { ...item(second), orderId: '' }, { ...item(second), dueAt: 'invalid' }, item(first)])(
  'validates the entire batch before consuming any claim: %j', async invalid => {
    const ctx = setup()
    ctx.rpc.mockResolvedValueOnce({ data: [item(first), invalid] })
    await expect(processDueSubscriptionSettlements(ctx)).rejects.toThrow()
    expect(ctx.rpc).toHaveBeenCalledTimes(1)
    expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
  })
it.each([0, 101, 1.5])('rejects invalid limits before storage: %s', async limit => {
  const ctx = setup()
  await expect(processDueSubscriptionSettlements({ ...ctx, limit })).rejects.toThrow('invalid_settlement_batch')
  expect(ctx.rpc).not.toHaveBeenCalled()
})
it('does not dispatch if a refund wins after discovery', async () => {
  const ctx = setup()
  ctx.rpc.mockResolvedValueOnce({ data: [item(first)] }).mockResolvedValueOnce({ error: { code: '55000' } })
  expect(await processDueSubscriptionSettlements(ctx)).toMatchObject({ processed: 0, failed: 1 })
  expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it('does not pass a mismatched persisted shop to the provider', async () => {
  const ctx = setup()
  ctx.rpc.mockResolvedValueOnce({ data: [item(first)] }).mockResolvedValueOnce({ data: {
    action: 'send', shopId: '999', body: {}, key: first, firstSentAt: '2026-09-27T00:00:01Z',
  } })
  expect(await processDueSubscriptionSettlements(ctx)).toMatchObject({ failed: 1 })
  expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it('continues the batch after a timeout; restart recovers without another POST', async () => {
  const ctx = setup([first, second])
  ctx.provider.createSettlement.mockRejectedValueOnce(Error('private response must not escape'))
  expect(await processDueSubscriptionSettlements(ctx)).toEqual({ state: 'processed', processed: 1, failed: 1, reviewRequired: 0 })
  expect(ctx.claims.get(first).status).toBe('unknown')
  ctx.provider.findSettlement.mockResolvedValue({ id: 'rt-recovered', status: 'succeeded' })
  expect(await reconcilePrepaymentSettlements(ctx)).toMatchObject({ checked: 2, failed: 0 })
  await processDueSubscriptionSettlements(ctx)
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(2)
})
it('a crash after claim but before HTTP does not permit resending', async () => {
  const ctx = setup()
  await ctx.rpc('claim_prepayment_settlement', { p_order_id: first })
  expect(await processDueSubscriptionSettlements(ctx)).toMatchObject({ processed: 0 })
  expect(await reconcilePrepaymentSettlements(ctx)).toMatchObject({ unresolved: 1 })
  expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it('a crash after provider success but before recording is recovered without POST', async () => {
  const ctx = setup()
  const originalRpc = ctx.rpc.getMockImplementation()
  ctx.rpc.mockImplementation(async (name, args) => name === 'record_prepayment_settlement'
    ? { error: { code: 'storage' } } : originalRpc(name, args))
  expect(await processDueSubscriptionSettlements(ctx)).toMatchObject({ failed: 1 })
  expect(ctx.claims.get(first).receiptId).toBeNull()
  ctx.rpc.mockImplementation(originalRpc)
  ctx.provider.findSettlement.mockResolvedValue({ id: 'rt-recovered', status: 'succeeded' })
  expect(await reconcilePrepaymentSettlements(ctx)).toMatchObject({ checked: 1 })
  await processDueSubscriptionSettlements(ctx)
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
})
it('overlapping workers use one POST even when both discovered the same order', async () => {
  const ctx = setup()
  ctx.rpc.mockResolvedValueOnce({ data: [item(first)] }).mockResolvedValueOnce({ data: [item(first)] })
  const results = await Promise.all([processDueSubscriptionSettlements(ctx), processDueSubscriptionSettlements(ctx)])
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
  expect(results.reduce((n, result) => n + result.reviewRequired, 0)).toBe(1)
})
