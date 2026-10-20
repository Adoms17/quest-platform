import { describe, it, expect, vi } from 'vitest'
import { runSandboxRecurring } from './sandboxRecurring.js'
import { SandboxPaymentError } from './yookassaSandbox.js'

function fixture(status = 'prepared') {
  const payment = { paymentId: 'payment', status: 'succeeded', paid: true, test: true }
  const repository = {
    applyPeriod: vi.fn().mockResolvedValue({ state: 'applied' }),
    beginAttempt: vi.fn().mockResolvedValue({ state: status }),
    readAttempt: vi.fn().mockResolvedValue({ id: 'order', providerMethodId: 'private-method' }),
    recordResult: vi.fn().mockResolvedValue({ ...payment, requiresReview: false }),
  }
  const provider = Object.fromEntries(['createRecurringPayment', 'readPayment', 'findPayment'].map(key => [key, vi.fn().mockResolvedValue(payment)]))
  return { repository, provider }
}
describe('sandbox recurring executor', () => {
  it('sends only a newly prepared attempt and exposes no method or payment details', async () => {
    const deps = fixture()
    expect(await runSandboxRecurring('order', deps)).toEqual({ status: 'applied' })
    expect(deps.provider.createRecurringPayment).toHaveBeenCalledOnce()
    expect(deps.repository.recordResult).toHaveBeenCalledOnce()
  })
  it('restores an unknown result by GET on the next run', async () => {
    const deps = fixture()
    deps.provider.createRecurringPayment.mockRejectedValue(new SandboxPaymentError('payment_outcome_unknown'))
    expect(await runSandboxRecurring('order', deps)).toEqual({ status: 'reconciliation_required' })
    expect(deps.repository.recordResult).not.toHaveBeenCalled()
    deps.repository.beginAttempt.mockResolvedValue({ state: 'reconciliation_required' })
    expect(await runSandboxRecurring('order', deps)).toEqual({ status: 'applied' })
    expect(deps.provider.createRecurringPayment).toHaveBeenCalledOnce()
    expect(deps.provider.findPayment).toHaveBeenCalledOnce()
  })
  it('does not POST when the search has no result', async () => {
    const deps = fixture('reconciliation_required')
    deps.provider.findPayment.mockResolvedValue(null)
    expect(await runSandboxRecurring('order', deps)).toEqual({ status: 'reconciliation_required' })
    expect(deps.provider.createRecurringPayment).not.toHaveBeenCalled()
  })
  it('reads an identified payment directly', async () => {
    const deps = fixture('reconciliation_required')
    deps.repository.readAttempt.mockResolvedValue({ id: 'order', providerPaymentId: 'known' })
    await runSandboxRecurring('order', deps)
    expect(deps.provider.readPayment).toHaveBeenCalledOnce()
    expect(deps.provider.findPayment).not.toHaveBeenCalled()
  })
  it('does not send zero or canceled orders', async () => {
    for (const status of ['canceled']) {
      const deps = fixture(status)
      expect(await runSandboxRecurring('order', deps)).toEqual({ status })
      expect(deps.repository.readAttempt).not.toHaveBeenCalled()
    }
  })
  it('preserves a persistence failure for later reconciliation', async () => {
    const deps = fixture()
    deps.repository.recordResult.mockRejectedValue(new Error('database unavailable'))
    await expect(runSandboxRecurring('order', deps)).rejects.toThrow('database unavailable')
    expect(deps.provider.createRecurringPayment).toHaveBeenCalledOnce()
  })
  it('propagates validation failures without recording a result', async () => {
    const deps = fixture()
    deps.provider.createRecurringPayment.mockRejectedValue(new SandboxPaymentError('payment_order_mismatch'))
    await expect(runSandboxRecurring('order', deps)).rejects.toMatchObject({ code: 'payment_order_mismatch' })
    expect(deps.repository.recordResult).not.toHaveBeenCalled()
  })
  it('reports conflicts instead of success', async () => {
    const deps = fixture()
    deps.repository.recordResult.mockResolvedValue({ status: 'succeeded', requiresReview: true })
    expect(await runSandboxRecurring('order', deps)).toEqual({ status: 'requires_review' })
  })
})

it('zero amount applies without payment calls', async () => {
 const deps=fixture('zero_amount')
 expect(await runSandboxRecurring('order',deps)).toEqual({status:'applied'})
 expect(deps.repository.applyPeriod).toHaveBeenCalledOnce()
 expect(deps.provider.createRecurringPayment).not.toHaveBeenCalled()
})
it('failed fulfillment is retried with GET, never a second POST',async()=>{
 const deps=fixture()
 deps.repository.applyPeriod.mockRejectedValueOnce(new Error('database unavailable'))
 await expect(runSandboxRecurring('order',deps)).rejects.toThrow('database unavailable')
 deps.repository.beginAttempt.mockResolvedValue({state:'reconciliation_required'})
 deps.repository.readAttempt.mockResolvedValue({id:'order',providerPaymentId:'known'})
 expect(await runSandboxRecurring('order',deps)).toEqual({status:'applied'})
 expect(deps.provider.createRecurringPayment).toHaveBeenCalledOnce()
 expect(deps.provider.readPayment).toHaveBeenCalledOnce()
})
it('future confirmed period remains deferred',async()=>{
 const deps=fixture();deps.repository.applyPeriod.mockResolvedValue({state:'deferred'})
 expect(await runSandboxRecurring('order',deps)).toEqual({status:'deferred'})
})