import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OrganizationPayments from './OrganizationPayments'
import OrderFiscalReceipts from './OrderFiscalReceipts'

const firstLoad = '2026-10-05T12:00:00.000Z'
const secondLoad = '2026-10-05T12:05:00.000Z'
const checkedAt = '2026-10-04T10:30:00.000Z'
const payment = { id: 'order-a', amount_minor: 99000, created_at: checkedAt, payment_status: 'pending', order_state: 'reserved', refunded_minor: 0, refund_pending_minor: 0, refund_review_minor: 0 }
const receipt = { id: 'receipt-a', kind: 'payment', amountMinor: 99000, status: 'pending', needsAttention: false }
const variants = [
 {
  name: 'payments', loaded: /^Данные платежей получены:/, checked: /^Последняя сверка платежа с ЮKassa:/,
  button: /Загрузить платежи/, row: value => ({ ...payment, payment_checked_at: value }),
  response: items => ({ items, next_cursor: null }),
  view: (read, workspace = 'org-a') => <OrganizationPayments api={{ payments: read }} organizationId={workspace} />,
 },
 {
  name: 'receipts', loaded: /^Данные чеков получены:/, checked: /^Последняя сверка чека с ЮKassa:/,
  button: /Загрузить данные чеков|Перечитать данные чеков/, row: value => ({ ...receipt, checkedAt: value }),
  response: items => ({ data: { items, truncated: false } }),
  view: (read, workspace = 'org-a', order = 'order-a') => <OrderFiscalReceipts client={{ rpc: read }} workspace={workspace} order={order} />,
 },
]
function deferred() {
 let resolve, reject
 const promise = new Promise((yes, no) => { resolve = yes; reject = no })
 return { promise, resolve, reject }
}
const timestamp = label => screen.getByText(label).querySelector('time')?.dateTime
const click = variant => fireEvent.click(screen.getByRole('button', { name: variant.button }))
let network
beforeEach(() => {
 vi.useFakeTimers({ toFake: ['Date'] })
 vi.setSystemTime(firstLoad)
 network = vi.fn(() => { throw Error('unexpected network') })
 vi.stubGlobal('fetch', network)
})
afterEach(() => {
 try { expect(network).not.toHaveBeenCalled() }
 finally { vi.unstubAllGlobals(); vi.useRealTimers() }
})

describe.each(variants)('$name data freshness', variant => {
 it.each([null, undefined, '', '   ', 'invalid-date'])('explicitly shows unknown check time for %j', async value => {
  const read = vi.fn().mockResolvedValue(variant.response([variant.row(value)]))
  render(variant.view(read))
  expect(screen.queryByText(variant.loaded)).toBeNull()
  expect(read).not.toHaveBeenCalled()
  await act(async () => click(variant))
  expect(screen.getByText(variant.checked)).toHaveTextContent('Неизвестно')
  expect(timestamp(variant.checked)).toBeUndefined()
  expect(timestamp(variant.loaded)).toBe(firstLoad)
  expect(screen.queryByText(/Invalid Date/)).toBeNull()
 })

 it('keeps successful load time separate from provider check time on reload', async () => {
  const response = variant.response([variant.row(checkedAt)])
  const original = structuredClone(response)
  const read = vi.fn().mockResolvedValue(response)
  render(variant.view(read))
  await act(async () => click(variant))
  expect(timestamp(variant.loaded)).toBe(firstLoad)
  expect(timestamp(variant.checked)).toBe(checkedAt)
  expect(screen.getByText(variant.checked)).toHaveTextContent(new Date(checkedAt).toLocaleString('ru-RU'))
  expect(screen.getByText(/часовому поясу устройства/)).toBeTruthy()
  expect(screen.getByText(/не запускает сверку с ЮKassa/)).toBeTruthy()
  vi.setSystemTime(secondLoad)
  await act(async () => click(variant))
  expect(timestamp(variant.loaded)).toBe(secondLoad)
  expect(timestamp(variant.checked)).toBe(checkedAt)
  expect(read).toHaveBeenCalledTimes(2)
  expect(response).toEqual(original)
 })

 it('dates empty success but clears the snapshot on a failed reload, then allows retry', async () => {
  const read = vi.fn().mockResolvedValueOnce(variant.response([]))
   .mockRejectedValueOnce(Error('private-error')).mockResolvedValueOnce(variant.response([]))
  render(variant.view(read))
  await act(async () => click(variant))
  expect(timestamp(variant.loaded)).toBe(firstLoad)
  vi.setSystemTime(secondLoad)
  await act(async () => click(variant))
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.queryByText(variant.loaded)).toBeNull()
  expect(screen.queryByText(/private-error/)).toBeNull()
  await act(async () => click(variant))
  expect(timestamp(variant.loaded)).toBe(secondLoad)
  expect(screen.queryByRole('alert')).toBeNull()
 })

 it('captures completion time, blocks repeated clicks and hides the old time while loading', async () => {
  const pending = deferred()
  const read = vi.fn().mockResolvedValueOnce(variant.response([])).mockReturnValueOnce(pending.promise)
  render(<StrictMode>{variant.view(read)}</StrictMode>)
  await act(async () => click(variant))
  const button = screen.getByRole('button', { name: variant.button })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  expect(read).toHaveBeenCalledTimes(2)
  expect(button).toBeDisabled()
  expect(screen.queryByText(variant.loaded)).toBeNull()
  vi.setSystemTime(secondLoad)
  await act(async () => pending.resolve(variant.response([])))
  expect(timestamp(variant.loaded)).toBe(secondLoad)
  expect(button).not.toBeDisabled()
 })

 it.each(['resolve', 'reject'])('ignores a late %s from the previous organization', async finish => {
  const old = deferred()
  const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(variant.response([]))
  const view = render(variant.view(read))
  click(variant)
  view.rerender(variant.view(read, 'org-b'))
  expect(screen.queryByText(variant.loaded)).toBeNull()
  vi.setSystemTime(secondLoad)
  await act(async () => click(variant))
  expect(timestamp(variant.loaded)).toBe(secondLoad)
  vi.setSystemTime('2026-10-05T12:10:00.000Z')
  await act(async () => old[finish](finish === 'resolve' ? variant.response([variant.row(checkedAt)]) : Error('old error')))
  expect(timestamp(variant.loaded)).toBe(secondLoad)
  expect(screen.queryByText(variant.checked)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
 })

 it('does not retain a successful snapshot when changing organization', async () => {
  const read = vi.fn().mockResolvedValue(variant.response([variant.row(checkedAt)]))
  const view = render(variant.view(read))
  await act(async () => click(variant))
  expect(timestamp(variant.loaded)).toBe(firstLoad)
  view.rerender(variant.view(read, 'org-b'))
  expect(screen.queryByText(variant.loaded)).toBeNull()
  expect(screen.queryByText(variant.checked)).toBeNull()
  expect(read).toHaveBeenCalledTimes(1)
 })
})

it('payment pagination replaces the whole snapshot and cannot reuse its load time on failure', async () => {
 const variant = variants[0], next = deferred()
 const read = vi.fn().mockResolvedValueOnce({ items: [variant.row(checkedAt)], next_cursor: 'next' })
  .mockReturnValueOnce(next.promise)
 render(variant.view(read))
 await act(async () => click(variant))
 fireEvent.click(screen.getByRole('button', { name: 'Следующая страница платежей' }))
 expect(read).toHaveBeenLastCalledWith('org-a', 'next')
 expect(screen.queryByText(variant.loaded)).toBeNull()
 expect(screen.queryByText(variant.checked)).toBeNull()
 vi.setSystemTime(secondLoad)
 await act(async () => next.resolve({ items: [], next_cursor: 'last' }))
 expect(timestamp(variant.loaded)).toBe(secondLoad)
 expect(screen.getByText('Тестовых платежей нет.')).toBeTruthy()
 read.mockRejectedValueOnce(Error('page failed'))
 await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Следующая страница платежей' })))
 expect(read).toHaveBeenLastCalledWith('org-a', 'last')
 expect(screen.queryByText(variant.loaded)).toBeNull()
 expect(screen.getByRole('alert')).toBeTruthy()
})

it.each(['resolve', 'reject'])('receipt order change clears loaded data and ignores an old in-flight %s', async finish => {
 const variant = variants[1], old = deferred()
 const read = vi.fn().mockResolvedValueOnce(variant.response([variant.row(checkedAt)]))
  .mockReturnValueOnce(old.promise).mockResolvedValueOnce(variant.response([]))
 const view = render(variant.view(read))
 await act(async () => click(variant))
 click(variant)
 view.rerender(variant.view(read, 'org-a', 'order-b'))
 expect(screen.queryByText(variant.loaded)).toBeNull()
 expect(screen.queryByText(variant.checked)).toBeNull()
 vi.setSystemTime(secondLoad)
 await act(async () => click(variant))
 expect(read).toHaveBeenLastCalledWith('read_platform_order_receipts', { p_organization_id: 'org-a', p_order_id: 'order-b' })
 await act(async () => old[finish](finish === 'resolve' ? variant.response([variant.row(checkedAt)]) : Error('old error')))
 expect(timestamp(variant.loaded)).toBe(secondLoad)
 expect(screen.queryByText(variant.checked)).toBeNull()
 expect(screen.queryByRole('alert')).toBeNull()
})
