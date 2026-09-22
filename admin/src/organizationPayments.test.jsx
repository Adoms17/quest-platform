import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import OrganizationPayments from './OrganizationPayments'
import { createAdminApi } from './api'
const item = { id: 'order-a', amount_minor: 12345, currency: 'RUB', created_at: '2026-09-22', order_state: 'finished', payment_status: 'succeeded', payment_id: 'payment-a', refunded_minor: 1000, refund_pending_minor: 2000, refund_review_minor: 3000, refund_requires_review: true }
const clickLoad = () => fireEvent.click(screen.getByText('Загрузить платежи'))
test('использует RPC с организацией и курсором', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({ data: { items: [], next_cursor: null }, error: null }) }
 await createAdminApi(client).payments('org-a', 'cursor-a')
 expect(client.rpc).toHaveBeenCalledWith('read_platform_organization_payments', { p_organization_id: 'org-a', p_after: 'cursor-a' })
})
test('по запросу показывает статусы, суммы и пагинацию без служебных полей', async () => {
 const api = { payments: vi.fn().mockResolvedValueOnce({ items: [{ ...item, confirmation_url: 'private-url', actor_id: 'private-actor' }], next_cursor: 'cursor' }).mockResolvedValueOnce({ items: [], next_cursor: null }) }
 render(<OrganizationPayments api={api} organizationId="org-a" />)
 expect(api.payments).not.toHaveBeenCalled()
 clickLoad()
 await screen.findByText(/123,45.*Оплачен/)
 expect(screen.getByText(/Возвращено: 10,00.*Ожидает возврата: 20,00/)).toBeTruthy()
 expect(screen.getByText(/Возвраты на проверке: 30,00/)).toBeTruthy()
 expect(screen.getByText(/Требуется проверка возврата/)).toBeTruthy()
 expect(screen.queryByText(/private-/)).toBeNull()
 expect(api.payments).toHaveBeenCalledWith('org-a', null)
 fireEvent.click(screen.getByText('Следующая страница платежей'))
 await screen.findByText('Тестовых платежей нет.')
 expect(api.payments).toHaveBeenLastCalledWith('org-a', 'cursor')
})
test('ошибка доступа убирает прежние данные, повтор после сетевой ошибки возможен', async () => {
 const api = { payments: vi.fn().mockResolvedValueOnce({ items: [item] }).mockRejectedValueOnce({ code: '42501', message: 'private-error' }).mockRejectedValueOnce(new Error('private-network')).mockResolvedValueOnce({ items: [] }) }
 render(<OrganizationPayments api={api} organizationId="org-a" />)
 clickLoad(); await screen.findByText('Заказ: order-a')
 clickLoad(); await screen.findByText(/Доступ не предоставлен/)
 expect(screen.queryByText('Заказ: order-a')).toBeNull()
 clickLoad(); await screen.findByText(/Проверьте соединение/)
 expect(screen.queryByText(/private-/)).toBeNull()
 clickLoad(); await screen.findByText('Тестовых платежей нет.')
})
test('поздний ответ прежней организации не попадает в новую карточку', async () => {
 let resolveOld
 const api = { payments: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce({ items: [] }) }
 const view = render(<OrganizationPayments api={api} organizationId="org-a" />)
 clickLoad(); clickLoad()
 expect(api.payments).toHaveBeenCalledTimes(1)
 view.rerender(<OrganizationPayments api={api} organizationId="org-b" />)
 clickLoad(); await screen.findByText('Тестовых платежей нет.')
 await act(async () => resolveOld({ items: [item] }))
 expect(screen.queryByText('Заказ: order-a')).toBeNull()
 expect(api.payments).toHaveBeenLastCalledWith('org-b', null)
})
test('отсутствующий платёж не обозначается как оплаченный', async () => {
 const api = { payments: vi.fn().mockResolvedValue({ items: [{ ...item, payment_status: 'not_created', payment_id: null, refund_requires_review: false }] }) }
 render(<OrganizationPayments api={api} organizationId="org-a" />)
 clickLoad(); await screen.findByText(/Платёж не создан/)
 expect(screen.queryByText(/Оплачен/)).toBeNull()
 expect(screen.queryByText('Платёж: payment-a')).toBeNull()
})
