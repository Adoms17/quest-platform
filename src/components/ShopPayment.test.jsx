import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
const api = vi.hoisted(() => ({ readShopPaymentAvailability: vi.fn(), checkoutShopPayment: vi.fn(), reconcileShopPayment: vi.fn() }))
vi.mock('../services/shopPaymentApi', () => api)
import ShopPayment from './ShopPayment'
const order = { id: 'order', snapshot: { organization_name: 'Organization' } }
beforeEach(() => {
  vi.resetAllMocks()
  api.readShopPaymentAvailability.mockResolvedValue({ status: 'available' })
  api.reconcileShopPayment.mockResolvedValue({ status: 'pending', confirmationUrl: null })
})
afterEach(cleanup)
const ready = async () => { await act(async () => {}); return screen.getByRole('button', { name: 'Перейти к оплате' }) }
it('entry and reload only probe/reconcile; canceled confirmation never dispatches', async () => {
  const view = render(<ShopPayment order={order} onRefresh={() => {}} />)
  fireEvent.click(await ready()); fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(api.checkoutShopPayment).not.toHaveBeenCalled()
  view.unmount(); render(<ShopPayment order={order} onRefresh={() => {}} />); await ready()
  expect(api.reconcileShopPayment).toHaveBeenCalledTimes(2)
  expect(api.checkoutShopPayment).not.toHaveBeenCalled()
})
it('keeps dispatch disabled if availability fails', async () => {
  api.readShopPaymentAvailability.mockRejectedValue(new Error('disabled'))
  render(<ShopPayment order={order} onRefresh={() => {}} />)
  expect(await ready()).toBeDisabled(); expect(api.reconcileShopPayment).not.toHaveBeenCalled()
})
it('deduplicates sends and Close ignores late response without declaring cancellation', async () => {
  let finish
  api.checkoutShopPayment.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<ShopPayment order={order} onRefresh={() => {}} />)
  fireEvent.click(await ready())
  const send = screen.getByRole('button', { name: 'Продолжить оплату' })
  fireEvent.click(send); fireEvent.click(send); await act(async () => {})
  expect(api.checkoutShopPayment).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть ожидание' }))
  await act(async () => finish({ status: 'pending', confirmationUrl: 'https://yoomoney.ru/test' }))
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText(/Это не отменяет платёж/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Перейти к оплате' })).toBeDisabled()
})
it('does not use results from an unmounted organization/order', async () => {
  let finish; const refresh = vi.fn()
  api.reconcileShopPayment.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<ShopPayment order={order} onRefresh={refresh} />)
  await act(async () => {}); view.unmount()
  await act(async () => finish({ status: 'pending', confirmationUrl: 'https://yoomoney.ru/test' }))
  expect(refresh).not.toHaveBeenCalled(); expect(api.checkoutShopPayment).not.toHaveBeenCalled()
})
