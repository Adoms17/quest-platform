// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runSubscriptionSettlementOrder } from './subscriptionSettlementOrder.js'
const orderId = '11111111-1111-4111-8111-111111111111'
function setup() {
  let claimed = false
  let receiptId = null
  const provider = {
    createSettlement: vi.fn(async () => ({ id: 'rt-one', status: 'pending' })),
    readSettlement: vi.fn(async () => ({ id: 'rt-one', status: 'succeeded' })),
    findSettlement: vi.fn(async () => ({ id: 'rt-one', status: 'succeeded' })),
  }
  const rpc = vi.fn(async (name, args) => {
    expect(args.p_order_id).toBe(orderId)
    if (name === 'claim_prepayment_settlement') {
      if (claimed) return { data: { action: 'reconcile', shopId: '123', receiptId } }
      claimed = true
      return { data: { action: 'send', shopId: '123', body: { type: 'payment' }, key: orderId, firstSentAt: '2026-09-30T00:00:00Z' } }
    }
    if (name === 'record_prepayment_settlement') { receiptId = args.p_receipt_id; return { error: null } }
    throw Error('Unexpected batch or RPC')
  })
  return { enabled: true, orderId, shopId: '123', rpc, provider }
}
it.each([undefined, false, 'true'])('requires explicit enablement: %s', async enabled => {
  const ctx = setup()
  expect(await runSubscriptionSettlementOrder({ ...ctx, enabled })).toEqual({ state: 'disabled' })
  expect(ctx.rpc).not.toHaveBeenCalled()
})
it.each(['', 'invalid', null])('rejects invalid target %s before storage', async orderId => {
  const ctx = setup()
  await expect(runSubscriptionSettlementOrder({ ...ctx, orderId })).rejects.toThrow('invalid_settlement_target')
  expect(ctx.rpc).not.toHaveBeenCalled()
})
it('uses only exact-order claim and record; repeat reads the receipt', async () => {
  const ctx = setup()
  expect(await runSubscriptionSettlementOrder(ctx)).toEqual({ state: 'pending' })
  expect(await runSubscriptionSettlementOrder(ctx)).toEqual({ state: 'succeeded' })
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
  expect(ctx.provider.readSettlement).toHaveBeenCalledTimes(1)
})
it('overlapping invocations consume one durable claim', async () => {
  const ctx = setup()
  await Promise.all([runSubscriptionSettlementOrder(ctx), runSubscriptionSettlementOrder(ctx)])
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
})
it('SQL refusal before period end or after refund does not send', async () => {
  const ctx = setup()
  ctx.rpc.mockResolvedValueOnce({ error: { code: '55000' } })
  await expect(runSubscriptionSettlementOrder(ctx)).rejects.toThrow()
  expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it.each(['send', 'reconcile'])('rejects a foreign persisted shop on %s', async action => {
  const ctx = setup()
  ctx.rpc.mockResolvedValueOnce({ data: { action, shopId: '999', body: {}, key: orderId, firstSentAt: '2026-09-30T00:00:00Z', receiptId: 'rt-one' } })
  await expect(runSubscriptionSettlementOrder(ctx)).rejects.toThrow('settlement_target_mismatch')
  expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
  expect(ctx.provider.readSettlement).not.toHaveBeenCalled()
})
it('timeout after consuming claim recovers by lookup, never another POST', async () => {
  const ctx = setup()
  ctx.provider.createSettlement.mockRejectedValueOnce(Error('timeout'))
  await expect(runSubscriptionSettlementOrder(ctx)).rejects.toThrow('timeout')
  expect(await runSubscriptionSettlementOrder(ctx)).toEqual({ state: 'succeeded' })
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
  expect(ctx.provider.findSettlement).toHaveBeenCalledTimes(1)
})
it('unresolved lookup leaves the operation for review', async () => {
  const ctx = setup()
  ctx.provider.createSettlement.mockRejectedValueOnce(Error('timeout'))
  await expect(runSubscriptionSettlementOrder(ctx)).rejects.toThrow()
  ctx.provider.findSettlement.mockResolvedValue(null)
  expect(await runSubscriptionSettlementOrder(ctx)).toEqual({ state: 'review_required' })
  expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
})
