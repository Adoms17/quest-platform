import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const api = vi.hoisted(() => ({ listRecurringConsents: vi.fn(), revokeRecurringConsent: vi.fn() }))
vi.mock('../services/recurringConsentApi', () => api)
import OrganizationRecurringConsent from './OrganizationRecurringConsent'
const item = { consentId: 'c', orderId: 'closed-order', state: 'saved', createdAt: '2026-09-23T00:00:00Z' }
beforeEach(() => { vi.resetAllMocks(); api.listRecurringConsents.mockResolvedValue([item]) })
test('отзывает согласие закрытого заказа без нового платежа и блокирует двойной клик', async () => {
 let finish
 api.revokeRecurringConsent.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 render(<OrganizationRecurringConsent organizationId="org" />)
 const button = await screen.findByRole('button', { name: 'Отозвать согласие' })
 fireEvent.click(button); fireEvent.click(button)
 expect(api.revokeRecurringConsent).toHaveBeenCalledTimes(1)
 expect(api.revokeRecurringConsent).toHaveBeenCalledWith('org', 'closed-order', 'c')
 api.listRecurringConsents.mockResolvedValue([{ ...item, state: 'revoked' }])
 await act(async () => finish())
 await screen.findByText('Согласие отозвано.')
 expect(screen.queryByRole('button', { name: 'Отозвать согласие' })).toBeNull()
})
test('ошибка не объявляет отзыв успешным и допускает повтор чтения', async () => {
 api.revokeRecurringConsent.mockRejectedValue(new Error('private'))
 render(<OrganizationRecurringConsent organizationId="org" />)
 fireEvent.click(await screen.findByRole('button', { name: 'Отозвать согласие' }))
 await screen.findByRole('alert')
 expect(screen.queryByText('private')).toBeNull()
 expect(screen.queryByText('Согласие отозвано.')).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Обновить согласия' }))
 await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
test('поздний ответ предыдущей организации не заменяет новую', async () => {
 let finish
 api.listRecurringConsents.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([])
 const { rerender } = render(<OrganizationRecurringConsent organizationId="a" />)
 rerender(<OrganizationRecurringConsent organizationId="b" />)
 await screen.findByText(/Согласий на автопродление нет/)
 await act(async () => finish([item]))
 expect(screen.queryByRole('button', { name: 'Отозвать согласие' })).toBeNull()
})