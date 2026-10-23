// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runSandboxCheckout } from './sandboxCheckout.js'
const payment = { paymentId: 'payment', status: 'pending', paid: false, test: true, confirmationUrl: 'https://yoomoney.ru/test' }
function fixture() {
  let stored = null
  let fail = true
  const rpc = vi.fn(async name => {
    if (name === 'read_sandbox_payment_order') return { data: { order: { id: 'order', providerPaymentId: stored?.payment_id } } }
    if (name === 'begin_sandbox_payment_send') return { data: { can_send: true, order: { id: 'order', idempotencyKey: 'same-key' } } }
    if (fail) { fail = false; return { error: { message: 'write failed' } } }
    stored = { order_id: 'order', payment_id: 'payment', status: 'pending', requires_review: false, confirmation_url: payment.confirmationUrl }
    return { data: stored }
  })
  return { rpc, provider: { createPayment: vi.fn().mockResolvedValue(payment), readPayment: vi.fn().mockResolvedValue(payment) } }
}
it('не возвращает ссылку при сбое записи; повтор сохраняет ключ, затем использует GET', async () => {
  const deps = fixture()
  await expect(runSandboxCheckout('order', deps)).rejects.toThrow('sandbox_storage_unavailable')
  expect((await runSandboxCheckout('order', deps)).confirmationUrl).toBe(payment.confirmationUrl)
  expect(deps.provider.createPayment.mock.calls[0]).toEqual(deps.provider.createPayment.mock.calls[1])
  await runSandboxCheckout('order', deps)
  expect(deps.provider.createPayment).toHaveBeenCalledTimes(2)
  expect(deps.provider.readPayment).toHaveBeenCalledTimes(1)
})
it('ошибка провайдера не записывается как успешный результат', async () => {
  const deps = fixture()
  deps.provider.createPayment.mockRejectedValue(new Error('payment_outcome_unknown'))
  await expect(runSandboxCheckout('order', deps)).rejects.toThrow('payment_outcome_unknown')
  expect(deps.rpc.mock.calls.some(([name]) => name === 'record_sandbox_payment_result')).toBe(false)
})
it('возвращает сохранённый финал вместо позднего pending', async () => {
  const deps = fixture()
  deps.rpc.mockImplementation(async name => ({ data: name === 'read_sandbox_payment_order' ? { order: { id: 'order', providerPaymentId: 'payment' } } : { order_id: 'order', payment_id: 'payment', status: 'succeeded', requires_review: true, confirmation_url: null } }))
  expect(await runSandboxCheckout('order', deps)).toMatchObject({ status: 'succeeded', confirmationUrl: null, requiresReview: true })
})
it('не возвращает идентификатор сохранённого метода клиенту', async () => {
  const deps = fixture()
  deps.provider.readPayment.mockResolvedValue({ ...payment, status: 'succeeded', paid: true, savedMethodId: 'private-method' })
  deps.rpc.mockImplementation(async name => ({ data: name === 'read_sandbox_payment_order' ? { order: { id: 'order', providerPaymentId: 'payment' } } : { order_id: 'order', payment_id: 'payment', status: 'succeeded', requires_review: false, confirmation_url: null } }))
  const result = await runSandboxCheckout('order', deps)
  expect(result).not.toHaveProperty('savedMethodId')
  expect(JSON.stringify(result)).not.toContain('private-method')
  expect(deps.rpc.mock.calls.find(([name]) => name === 'record_sandbox_payment_result')[1]).not.toHaveProperty('savedMethodId')
})
