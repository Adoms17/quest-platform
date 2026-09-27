// @vitest-environment node
import { expect, it } from 'vitest'
import { receiptFromSnapshot } from './receiptSnapshot.js'
const order = { id: '11111111-1111-4111-8111-111111111111', amountMinor: 6172, currency: 'RUB', environment: 'sandbox' }
const snapshot = { order_id: order.id, policy_id: '22222222-2222-4222-8222-222222222222', prepared_at: '2026-09-26T10:00:00Z',
 amount_minor: 6172, currency: 'RUB', email: 'receipt@example.test', description: 'Subscription', vat_code: 1, payment_subject: 'service', payment_mode: 'full_prepayment' }
it('maps original snapshot, ignoring later order policy and contact fields', () => {
 const result=receiptFromSnapshot(Object.freeze(snapshot), { ...order, email: 'new@example.test', vatCode: 2 })
 expect(result.customer.email).toBe(snapshot.email)
 expect(result.items[0]).toMatchObject({ amount: { value: '61.72', currency: 'RUB' }, vat_code: 1, payment_mode: 'full_prepayment' })
 expect(result).not.toHaveProperty('policy_id')
})
it.each([{ order_id: '33333333-3333-4333-8333-333333333333' }, { amount_minor: 6173 }, { amount_minor: '6172' },
 { currency: 'USD' }, { policy_id: null }, { prepared_at: 'invalid' }])('rejects mismatch %j', change => {
 expect(()=>receiptFromSnapshot({ ...snapshot, ...change },order)).toThrow('receipt_snapshot_mismatch')
})
it.each([null, { ...order, environment: 'production' }, { ...order, id: 'wrong' }])('rejects invalid order', value => {
 expect(()=>receiptFromSnapshot(snapshot,value)).toThrow('receipt_snapshot_mismatch')
})
it('still validates receipt content',()=>{
 expect(()=>receiptFromSnapshot({ ...snapshot, email: '' },order)).toThrow('invalid_receipt_email')
})
