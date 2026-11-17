import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const api = vi.hoisted(() => ({ readShopOffer: vi.fn(), createShopOrder: vi.fn(), readShopOrder: vi.fn(), listShopOrders: vi.fn() }))
const context = vi.hoisted(() => ({ value: null }))
vi.mock('../services/shopOrdersApi', () => api)
vi.mock('../services/shopPaymentApi', () => ({ readShopPaymentAvailability: vi.fn().mockRejectedValue(new Error('disabled')), reconcileShopPayment: vi.fn(), checkoutShopPayment: vi.fn() }))
vi.mock('../contexts/useOrganization', () => ({ useOrganization: () => context.value }))
import ShopCheckout from './ShopCheckout'
import ShopOrder from './ShopOrder'
import ShopPendingOrders from '../components/ShopPendingOrders'
import { ShopSnapshot } from '../components/ShopOrderDetails'
const organization = { id: 'org-a', permissions: ['billing.manage', 'quests.read', 'quests.create', 'quests.update'] }
const snapshot = { organization_id: 'org-a', organization_name: 'Server organization', product_title: 'Server product', version_label: 'v1', amount_minor: 12500, currency: 'RUB', price_version: 'price1', terms_id: 'terms1', terms: { text: 'Server conditions' } }
const offer = { snapshot, sales_enabled: true, existing_order_id: null, existing_acquisition_id: null }
const order = { id: 'order-a', snapshot, paid_state: 'unconfirmed', fulfillment_state: 'pending', acquisition_id: null, quest_id: null, copy_available: false, fulfillment_error: null }
function tree(path = '/organization/shop/offers/offer-a') { return <MemoryRouter initialEntries={[path]}><Routes><Route path="/organization/shop/offers/:offerId" element={<ShopCheckout session={{ user: { id: 'actor' } }} />} /><Route path="/organization/shop/orders/:orderId" element={<ShopOrder session={{ user: { id: 'actor' } }} />} /><Route path="/quests/copy/edit" element={<p>Editor</p>} /></Routes></MemoryRouter> }
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  context.value = { currentOrganization: organization, loadingOrganizations: false, organizationError: null }
  api.readShopOffer.mockResolvedValue(offer)
  api.createShopOrder.mockResolvedValue(order.id)
  api.readShopOrder.mockResolvedValue(order)
  api.listShopOrders.mockResolvedValue([order])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('formats server minor units exactly for ordinary and maximum safe integer amounts', () => {
  const view = render(<ShopSnapshot snapshot={{ ...snapshot, amount_minor: 12345 }} />)
  expect(screen.getByText('123.45 RUB')).toBeVisible()
  view.rerender(<ShopSnapshot snapshot={{ ...snapshot, amount_minor: Number.MAX_SAFE_INTEGER - 1 }} />)
  expect(screen.getByText('90071992547409.90 RUB')).toBeVisible()
})

it('uses server snapshot, requires confirmation, deduplicates clicks and opens saved order', async () => {
  let finish
  api.createShopOrder.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(tree())
  expect(await screen.findByText('Server organization')).toBeVisible()
  const save = screen.getByRole('button', { name: 'Сохранить заказ' })
  expect(save).toBeDisabled()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.queryByRole('button', { name: /оплатить/i })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(save); fireEvent.click(save)
  await act(async () => {})
  expect(api.createShopOrder).toHaveBeenCalledTimes(1)
  expect(api.createShopOrder.mock.calls[0].slice(0, 2)).toEqual(['org-a', 'offer-a'])
  await act(async () => finish(order.id))
  expect(await screen.findByRole('heading', { name: 'Ваш заказ' })).toBeVisible()
})

it('recovers committed order after lost response without issuing again', async () => {
  api.readShopOffer.mockResolvedValueOnce(offer).mockResolvedValueOnce(offer).mockResolvedValue({ ...offer, existing_order_id: order.id })
  api.createShopOrder.mockRejectedValue(new Error('lost response'))
  render(tree())
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }))
  expect(await screen.findByRole('heading', { name: 'Ваш заказ' })).toBeVisible()
  expect(api.createShopOrder).toHaveBeenCalledTimes(1)
})

it('requires new confirmation when server offer changes before save', async () => {
  api.readShopOffer.mockResolvedValueOnce(offer).mockResolvedValue({ ...offer, snapshot: { ...snapshot, amount_minor: 30000 } })
  render(tree())
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Предложение изменилось')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(api.createShopOrder).not.toHaveBeenCalled()
})

it('clears confirmation when recovery returns changed terms after create error', async () => {
  api.readShopOffer.mockResolvedValueOnce(offer).mockResolvedValueOnce(offer).mockResolvedValue({ ...offer, snapshot: { ...snapshot, terms_id: 'terms2' } })
  api.createShopOrder.mockRejectedValue(new Error('lost response'))
  render(tree())
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подтвердить сохранение')
  expect(screen.getByText('terms2')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Сохранить заказ' })).toBeDisabled()
})

it('restores order on entry and shows existing purchase without resale', async () => {
  api.readShopOffer.mockResolvedValue({ ...offer, existing_order_id: order.id })
  const view = render(tree())
  expect(await screen.findByRole('link', { name: 'Открыть существующий заказ' })).toHaveAttribute('href', `/organization/shop/orders/${order.id}`)
  expect(screen.queryByRole('checkbox')).toBeNull()
  view.unmount()
  api.readShopOffer.mockResolvedValue({ ...offer, existing_acquisition_id: 'purchase' })
  render(tree())
  expect(await screen.findByRole('link', { name: 'Открыть мои покупки' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Сохранить заказ' })).toBeNull()
})

it('ignores query paid flags and stops bounded polling; manual retry restarts reads', async () => {
  vi.useFakeTimers()
  render(tree('/organization/shop/orders/order-a?paid=true&status=succeeded'))
  await act(async () => {})
  expect(screen.getByText('Оплата: не подтверждена')).toBeVisible()
  for (let i = 0; i < 13; i++) await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  const count = api.readShopOrder.mock.calls.length
  expect(count).toBe(12)
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(api.readShopOrder).toHaveBeenCalledTimes(count)
  fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }))
  await act(async () => {})
  expect(api.readShopOrder).toHaveBeenCalledTimes(count + 1)
})

it('stops on offline and hidden until manual refresh', async () => {
  vi.useFakeTimers()
  render(tree('/organization/shop/orders/order-a'))
  await act(async () => {})
  act(() => window.dispatchEvent(new Event('offline')))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(api.readShopOrder).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }))
  await act(async () => {})
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(api.readShopOrder).toHaveBeenCalledTimes(2)
})

it('stops on error and retries manually without showing false empty data', async () => {
  api.readShopOrder.mockRejectedValueOnce(new Error('network')).mockResolvedValue(order)
  render(tree('/organization/shop/orders/order-a'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить заказ')
  fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }))
  expect(await screen.findByText('Оплата: не подтверждена')).toBeVisible()
})

it('times out a hanging request and keeps manual retry available', async () => {
  vi.useFakeTimers()
  api.readShopOrder.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(order)
  render(tree('/organization/shop/orders/order-a'))
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить заказ')
  expect(screen.getByRole('button', { name: 'Обновить статус' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }))
  await act(async () => {})
  expect(screen.getByText('Оплата: не подтверждена')).toBeVisible()
})

it('continues with in-memory operation ID when session storage is disabled', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
  try {
    render(tree())
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }))
    expect(await screen.findByRole('heading', { name: 'Ваш заказ' })).toBeVisible()
    expect(api.createShopOrder).toHaveBeenCalledTimes(1)
  } finally { get.mockRestore(); set.mockRestore() }
})

it('clears old organization and ignores its late response', async () => {
  let finish
  api.readShopOrder.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockRejectedValue(new Error('different org'))
  const view = render(tree('/organization/shop/orders/order-a'))
  context.value = { ...context.value, currentOrganization: { ...organization, id: 'org-b' } }
  view.rerender(tree('/organization/shop/orders/order-a'))
  await act(async () => finish(order))
  expect(screen.queryByText('Server organization')).toBeNull()
  expect(await screen.findByRole('alert')).toBeVisible()
})

it('shows delivery separately, stops terminal polling and never links deleted copy', async () => {
  api.readShopOrder.mockResolvedValue({ ...order, paid_state: 'succeeded', fulfillment_state: 'entitled' })
  const view = render(tree('/organization/shop/orders/order-a'))
  expect(await screen.findByText('Оплата получена. Готовим ваш квест')).toBeVisible()
  api.readShopOrder.mockResolvedValue({ ...order, paid_state: 'succeeded', fulfillment_state: 'complete', quest_id: 'copy' })
  fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }))
  expect(await screen.findByText(/Исходная копия удалена/)).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Открыть в редакторе' })).toBeNull()
  view.unmount()
  api.readShopOrder.mockResolvedValue({ ...order, fulfillment_error: 'P0001' })
  render(tree('/organization/shop/orders/order-a'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не платите снова')
  expect(screen.queryByText('P0001')).toBeNull()
})

it('pending library displays orders and has explicit error/retry', async () => {
  api.listShopOrders.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([order])
  render(<MemoryRouter><ShopPendingOrders organizationId="org-a" /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить заказы')
  expect(screen.queryByText('Незавершённых заказов нет.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить заказы' }))
  expect(await screen.findByRole('link', { name: 'Открыть заказ order-a' })).toBeVisible()
})
