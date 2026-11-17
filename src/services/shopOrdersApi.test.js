import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { readShopOffer, readShopOrder, listShopOrders, createShopOrder } from './shopOrdersApi'
const org = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000003'
const snapshot = { organization_id: org, organization_name: 'Synthetic', product_id: id, product_title: 'Quest', version_id: id, version_label: 'v1', offer_id: id, price_version: 'p1', amount_minor: 12345, currency: 'RUB', terms_id: 't1', terms: { text: 'Synthetic terms' } }
const order = { id, snapshot, paid_state: 'unconfirmed', fulfillment_state: 'pending', acquisition_id: null, quest_id: null, copy_available: false, fulfillment_error: null }
beforeEach(() => rpc.mockReset())
it('validates offer identity, price and terms instead of accepting malformed server data', async () => {
  for (const patch of [{ organization_id: other }, { offer_id: other }, { amount_minor: '12345' }, { amount_minor: 0 }, { terms: null }, { terms_id: '' }]) {
    rpc.mockResolvedValue({ data: { snapshot: { ...snapshot, ...patch }, sales_enabled: true, existing_order_id: null, existing_acquisition_id: null } })
    await expect(readShopOffer(org, id)).rejects.toThrow()
  }
})
it('propagates cancellation and errors; a failed list is never an empty list', async () => {
  const signal = new AbortController().signal
  const abortSignal = vi.fn().mockResolvedValue({ data: order })
  rpc.mockReturnValue({ abortSignal })
  expect(await readShopOrder(id, org, signal)).toEqual(order)
  expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
  const error = { code: '42501' }
  rpc.mockResolvedValue({ error })
  await expect(listShopOrders(org)).rejects.toBe(error)
})
it('rejects wrong order, organization and impossible states', async () => {
  for (const patch of [{ id: other }, { snapshot: { ...snapshot, organization_id: other } }, { paid_state: 'canceled' }, { fulfillment_state: 'complete' }, { copy_available: true }]) {
    rpc.mockResolvedValue({ data: { ...order, ...patch } })
    await expect(readShopOrder(id, org)).rejects.toThrow()
  }
  rpc.mockResolvedValue({ data: [order, { ...order, snapshot: { ...snapshot, organization_id: other } }] })
  await expect(listShopOrders(org)).rejects.toThrow()
})
it('retries the same command after response loss without payment flags', async () => {
  rpc.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({ data: id })
  await expect(createShopOrder(org, id, other)).rejects.toThrow()
  expect(await createShopOrder(org, id, other)).toBe(id)
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  expect(rpc.mock.calls[1][1]).toEqual({ p_organization_id: org, p_offer_id: id, p_operation_id: other })
})
it('invalid inputs never reach backend', async () => {
  await expect(readShopOrder('bad', org)).rejects.toThrow()
  await expect(createShopOrder(org, id, null)).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
it('bounds a hanging write and aborts its transport so retry can recover server state', async () => {
  vi.useFakeTimers()
  try {
    const abortSignal = vi.fn(() => new Promise(() => {}))
    rpc.mockReturnValue({ abortSignal })
    const outcome = expect(createShopOrder(org, id, other)).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15000)
    await outcome
    expect(abortSignal.mock.calls[0][0].aborted).toBe(true)
  } finally { vi.useRealTimers() }
})
it('external cancellation aborts transport immediately', async () => {
  const abortSignal = vi.fn(() => new Promise(() => {}))
  rpc.mockReturnValue({ abortSignal })
  const controller = new AbortController()
  const outcome = expect(listShopOrders(org, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await outcome
  expect(abortSignal.mock.calls[0][0].aborted).toBe(true)
})
