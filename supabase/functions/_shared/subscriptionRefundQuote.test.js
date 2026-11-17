// @vitest-environment node
import { expect, test } from 'vitest'
import { quoteSubscriptionRefund as quote } from './subscriptionRefundQuote.js'
const base = { paidMinor: 99000, periodStartMs: 1000, periodEndMs: 11000, requestedAtMs: 6000 }
test('refunds actual discounted payment, not list price', () => {
 expect(quote(base).amountMinor).toBe(49500)
 expect(quote({ ...base, paidMinor: 49500 }).amountMinor).toBe(24750)
})
test.each([0, 1000])('full refund before or at start %s', requestedAtMs => {
 expect(quote({ ...base, requestedAtMs }).amountMinor).toBe(99000)
})
test.each([11000, 12000])('no time remains at or after end %s', requestedAtMs => {
 expect(quote({ ...base, requestedAtMs })).toMatchObject({ amountMinor: 0, reason: 'no_refundable_time' })
})
test('prior refunds cap available funds without treating them as used time', () => {
 expect(quote({ ...base, refundedMinor: 80000 }).amountMinor).toBe(19000)
 expect(quote({ ...base, refundedMinor: 10000 }).amountMinor).toBe(49500)
})
test('in-flight or unknown refunds block a new quote', () => {
 expect(quote({ ...base, reservedMinor: 1 })).toMatchObject({ amountMinor: 0, reason: 'refund_pending' })
})
test('zero payment and full refund have explicit reasons', () => {
 expect(quote({ ...base, paidMinor: 0 }).reason).toBe('no_payment')
 expect(quote({ ...base, refundedMinor: 99000 }).reason).toBe('fully_refunded')
})
test('rounds a half kopeck upwards with integer arithmetic', () => {
 expect(quote({ ...base, paidMinor: 1 }).amountMinor).toBe(1)
})
test('uses actual interval length across month and timezone boundaries', () => {
 const start = Date.parse('2026-02-01T00:00:00+03:00')
 const end = Date.parse('2026-03-01T00:00:00+03:00')
 expect(quote({ ...base, periodStartMs: start, periodEndMs: end, requestedAtMs: start + (end-start)/2 }).amountMinor).toBe(49500)
})
test('large safe inputs do not lose precision during multiplication', () => {
 expect(quote({ ...base, paidMinor: Number.MAX_SAFE_INTEGER }).amountMinor).toBe(4503599627370496)
})
test.each([{ paidMinor: -1 }, { paidMinor: 1.5 }, { paidMinor: NaN },
 { refundedMinor: 99001 }, { refundedMinor: 99000, reservedMinor: 1 },
 { requestedAtMs: NaN }, { requestedAtMs: '6000' }, { periodEndMs: 1000 },
 { periodEndMs: 0 }, { reservedMinor: -1 }])('rejects invalid snapshot %j', patch => {
 expect(() => quote({ ...base, ...patch })).toThrow()
})
test('same persisted request time gives the same result on retry', () => {
 expect(quote(base)).toEqual(quote({ ...base }))
})
