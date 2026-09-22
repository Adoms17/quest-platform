vi.mock('../supabaseClient', () => ({ supabase: {} }))
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ readSandboxCheckout: vi.fn(), recoverSandboxCheckout: vi.fn(), loadSandboxOffer: vi.fn(), checkSandboxCheckout: vi.fn() }))
vi.mock('../services/sandboxCheckoutApi', () => mocks)
import SandboxCheckout from './SandboxCheckout'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.readSandboxCheckout.mockReturnValue('order')
  mocks.recoverSandboxCheckout.mockResolvedValue('order')
  mocks.loadSandboxOffer.mockResolvedValue({ order_id: 'order', plan_name: 'Тестовый тариф', amount_minor: 100, period_start: '2026-09-16T00:00:00Z', period_end: '2026-10-16T00:00:00Z', state: 'reserved' })
})
test('просмотр не вызывает оплату; требуется подтверждение и двойной клик блокируется', async () => {
  mocks.checkSandboxCheckout.mockReturnValue(new Promise(() => {}))
  render(<SandboxCheckout actorId="a" organizationId="o" />)
  const button = await screen.findByRole('button', { name: 'Подтвердить тестовую оплату' })
  expect(button.disabled).toBe(true)
  expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button); fireEvent.click(button)
  expect(mocks.checkSandboxCheckout).toHaveBeenCalledTimes(1)
})
test('ошибка допускает повтор того же заказа, success не заявляет активацию', async () => {
  mocks.checkSandboxCheckout.mockRejectedValueOnce(new Error('secret')).mockResolvedValue({ status: 'succeeded', confirmationUrl: null })
  render(<SandboxCheckout actorId="a" organizationId="o" />)
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить тестовую оплату' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('secret')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Проверить платёж' }))
  await screen.findByText('Тестовая оплата прошла. Активация подписки проверяется отдельно.')
  expect(mocks.checkSandboxCheckout).toHaveBeenCalledTimes(2)
})
test.each([
  ['canceled', false, 'Платёж отменён. Этот заказ не продлевает подписку. Для новой оплаты закройте заказ и выберите доступное предложение.'],
  ['waiting_for_capture', false, 'Платёж ожидает подтверждения списания. Оплаченный период ещё не подтверждён.'],
  ['canceled', true, 'Статус платежа требует проверки. Не создавайте повторную оплату до завершения сверки.'],
])('серверный статус %s виден после загрузки без новой оплаты', async (payment_status, payment_requires_review, message) => {
  mocks.loadSandboxOffer.mockResolvedValue({ order_id: 'order', plan_name: 'Тест', amount_minor: 100, period_start: '2026-09-16', period_end: '2026-10-16', state: 'finished', payment_status, payment_requires_review })
  render(<SandboxCheckout actorId="a" organizationId="o" />)
  await screen.findByText(message)
  expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
  if (payment_requires_review) {
    expect(screen.queryByText(/Этот заказ не продлевает/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Закрыть завершённый заказ' })).toBeNull()
  }
})

test('возврат показан отдельно от действующего доступа', async () => {
  mocks.loadSandboxOffer.mockResolvedValue({ order_id: 'order', plan_name: 'Тест', amount_minor: 1000, period_start: '2026-09-16', period_end: '2026-10-16', state: 'finished', fulfillment_state: 'applied', refunded_minor: 400, refund_pending_minor: 600 })
  render(<SandboxCheckout actorId="a" organizationId="o" />)
  await screen.findByText(/Возвращено:.*4,00/)
  expect(screen.getByText('Возврат обрабатывается. Доступ по подписке не изменён.')).toBeTruthy()
  expect(screen.getByText('Оплаченный тестовый период применён.')).toBeTruthy()
  expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
})

test('смена сохранённого заказа после просмотра запрещает отправку', async () => {
  render(<SandboxCheckout actorId="a" organizationId="o" />)
  fireEvent.click(await screen.findByRole('checkbox'))
  mocks.readSandboxCheckout.mockReturnValue('another')
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить тестовую оплату' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
})

test('купленный после trial период показан отложенным, скидка восстановлена с сервера', async () => {
 mocks.loadSandboxOffer.mockResolvedValue({ order_id: 'order', plan_name: 'Pro', amount_minor: 6172, period_start: '2026-10-16', period_end: '2026-11-16', state: 'finished', fulfillment_state: 'applied', period_scheduled: true, discount: { base_amount_minor: 12345, discount_amount_minor: 6173, discount_bps: 5000 } })
 render(<SandboxCheckout actorId="a" organizationId="o" />)
 await screen.findByText('Оплата подтверждена. Оплаченный период начнётся после trial в указанную дату.')
 expect(screen.queryByText('Оплаченный тестовый период применён.')).toBeNull()
 expect(screen.getByText(/Без скидки:.*123,45.*Скидка:.*50%.*61,73/)).toBeTruthy()
 expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
})
test('смена тарифа в trial не показывает предварительные даты как окончательные', async () => {
 mocks.loadSandboxOffer.mockResolvedValue({ order_id: 'order', plan_name: 'Pro', amount_minor: 100, period_start: '2026-09-16', period_end: '2026-10-16', state: 'reserved', period_starts_on_confirmation: true })
 render(<SandboxCheckout actorId="a" organizationId="o" />)
 await screen.findByText('Период начнётся после подтверждения оплаты. Точные даты появятся после применения платежа.')
 expect(screen.queryByText(/^Период:/)).toBeNull()
})

test('повтор загрузки показывает ожидание и восстанавливает тот же заказ без оплаты', async () => {
 mocks.loadSandboxOffer.mockRejectedValueOnce(new Error('network'))
 render(<SandboxCheckout actorId="a" organizationId="o" />)
 const retry = await screen.findByRole('button', { name: 'Повторить загрузку' })
 let resolve
 mocks.loadSandboxOffer.mockReturnValueOnce(new Promise(done => { resolve = done }))
 fireEvent.click(retry)
 expect(screen.getByText('Загружаем условия заказа…')).toBeTruthy()
 await waitFor(() => expect(mocks.loadSandboxOffer).toHaveBeenCalledTimes(2))
 resolve({ order_id: 'order', plan_name: 'Pro', amount_minor: 100, period_start: '2026-10-05', period_end: '2026-11-05', state: 'reserved' })
 await screen.findByRole('button', { name: 'Подтвердить тестовую оплату' })
 expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
})

test('полностью возвращённый закрытый заказ не обещает новый доступ', async () => {
 mocks.loadSandboxOffer.mockResolvedValue({order_id:'order',plan_name:'Pro',amount_minor:200,period_start:'2026-10-05',period_end:'2026-11-05',state:'finished',payment_status:'succeeded',fulfillment_state:'not_paid',refunded_minor:200,refund_pending_minor:0,payment_requires_review:false})
 render(<SandboxCheckout actorId="a" organizationId="o" />)
 await screen.findByText('Заказ закрыт после полного возврата. Новый период по этому заказу не предоставлен; действующая подписка сохранена.')
 expect(screen.queryByText('Оплаченный тестовый период применён.')).toBeNull()
 expect(screen.getByRole('button',{name:'Закрыть завершённый заказ'})).toBeTruthy()
 expect(mocks.checkSandboxCheckout).not.toHaveBeenCalled()
})
