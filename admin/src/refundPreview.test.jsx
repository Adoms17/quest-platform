import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import RefundPreview from './RefundPreview'
import { createAdminApi } from './api'

test('полный остаток и частичная сумма; изменённый ввод удаляет старый расчёт', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({ data: { available_minor: 950, requested_minor: 950 }, error: null }) }
 render(<RefundPreview api={createAdminApi(client)} organizationId="org" orderId="order" />)
 fireEvent.click(screen.getByText('Рассчитать возврат'))
 fireEvent.click(screen.getByText('Рассчитать сумму'))
 await screen.findByText(/Сумма расчёта: 9,50/)
 expect(client.rpc).toHaveBeenLastCalledWith('preview_platform_sandbox_refund', { p_organization_id: 'org', p_order_id: 'order', p_amount_minor: null })
 fireEvent.change(screen.getByRole('textbox'), { target: { value: '2,50' } })
 expect(screen.queryByText(/Сумма расчёта/)).toBeNull()
 client.rpc.mockResolvedValue({ data: { available_minor: 950, requested_minor: 250 }, error: null })
 fireEvent.click(screen.getByText('Рассчитать сумму'))
 await screen.findByText(/Сумма расчёта: 2,50/)
 expect(client.rpc).toHaveBeenLastCalledWith('preview_platform_sandbox_refund', { p_organization_id: 'org', p_order_id: 'order', p_amount_minor: 250 })
})

test('неверный ввод не вызывает сервер; отказ очищает расчёт и скрывает внутреннюю ошибку', async () => {
 const api = { previewRefund: vi.fn().mockRejectedValue({ code: '42501', message: 'private' }) }
 render(<RefundPreview api={api} organizationId="org" orderId="order" />)
 fireEvent.click(screen.getByText('Рассчитать возврат'))
 fireEvent.change(screen.getByRole('textbox'), { target: { value: '1.234' } })
 fireEvent.click(screen.getByText('Рассчитать сумму'))
 expect(api.previewRefund).not.toHaveBeenCalled()
 fireEvent.change(screen.getByRole('textbox'), { target: { value: '1' } })
 fireEvent.click(screen.getByText('Рассчитать сумму'))
 await screen.findByText(/Доступ не предоставлен или отозван/)
 expect(screen.queryByText('private')).toBeNull()
 expect(screen.queryByText(/Сумма расчёта/)).toBeNull()
})
