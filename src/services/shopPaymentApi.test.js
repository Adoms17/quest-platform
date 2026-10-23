import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { functions: { invoke } } }))
import { checkoutShopPayment, readShopPaymentAvailability, reconcileShopPayment } from './shopPaymentApi'
const id = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { invoke.mockReset() })
afterEach(() => vi.useRealTimers())
it('uses authenticated existing Edge transport and only server order identity', async () => {
  invoke.mockResolvedValue({ data: { orderId: id, status: 'available' } })
  await readShopPaymentAvailability(id)
  expect(invoke.mock.calls[0][0]).toBe('shop-checkout')
  expect(invoke.mock.calls[0][1].body).toEqual({ orderId: id, action: 'availability' })
  invoke.mockResolvedValue({ data: { orderId: id, status: 'pending', confirmationUrl: 'https://yoomoney.ru/test' } })
  expect((await checkoutShopPayment(id)).confirmationUrl).toBe('https://yoomoney.ru/test')
  expect(invoke.mock.calls[1][1].body).toEqual({ orderId: id })
  await reconcileShopPayment(id)
  expect(invoke.mock.calls[2][0]).toBe('shop-reconcile')
})
it.each(['https://evil.test', 'javascript:alert(1)', 'https://yoomoney.ru.evil.test', 'https://a@yoomoney.ru', 'https://yoomoney.ru/#token'])('rejects unsafe confirmation %s', async confirmationUrl => {
  invoke.mockResolvedValue({ data: { orderId: id, status: 'pending', confirmationUrl } })
  await expect(checkoutShopPayment(id)).rejects.toThrow()
})
it.each([{ orderId: 'wrong', status: 'pending' }, { orderId: id, status: 'paid' }, { orderId: id, status: 'confirmed', confirmationUrl: 'https://yoomoney.ru' }])('rejects wrong binding/status/link', async data => {
  invoke.mockResolvedValue({ data }); await expect(checkoutShopPayment(id)).rejects.toThrow()
})
it('bounds hangs and never starts an already aborted operation', async () => {
  vi.useFakeTimers(); invoke.mockImplementation(() => new Promise(() => {}))
  const result = expect(checkoutShopPayment(id)).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(20000); await result
  expect(invoke.mock.calls[0][1].signal.aborted).toBe(true)
  const controller = new AbortController(); controller.abort()
  await expect(checkoutShopPayment(id, controller.signal)).rejects.toThrow()
  expect(invoke).toHaveBeenCalledTimes(1)
})
