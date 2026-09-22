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


test('объясняет ограничения суммы ЮKassa без выдачи результата расчёта', async () => {
 const api = { previewRefund: vi.fn().mockRejectedValue({ code: '22023', message: 'refund provider amount limits' }) }
 render(<RefundPreview api={api} organizationId="org" orderId="order" />)
 fireEvent.click(screen.getByText('Рассчитать возврат'))
 fireEvent.change(screen.getByRole('textbox'), { target: { value: '0,50' } })
 fireEvent.click(screen.getByText('Рассчитать сумму'))
 expect(await screen.findByRole('alert')).toHaveTextContent('Частичный возврат — от 1 ₽')
 expect(screen.queryByText(/Сумма расчёта/)).toBeNull()
})


test('после возврата скрывает старый остаток и получает новый расчёт с сервера', async () => {
 sessionStorage.clear()
 try {
  const client={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}}),mfa:{listFactors:vi.fn().mockResolvedValue({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:vi.fn().mockResolvedValue({})}}}
  const api={previewRefund:vi.fn().mockResolvedValueOnce({available_minor:200,requested_minor:100}).mockResolvedValue({available_minor:100,requested_minor:100}),confirmRefund:vi.fn().mockResolvedValue({refund_id:'refund'}),executeRefund:vi.fn().mockResolvedValue({state:'succeeded'})}
  render(<RefundPreview refundsEnabled api={api} client={client} organizationId="org" orderId="order" />)
  fireEvent.click(screen.getByText('Рассчитать возврат'))
  fireEvent.click(screen.getByText('Рассчитать сумму'))
  await screen.findByText(/Доступно для возврата: 2,00/)
  fireEvent.click(screen.getByText('Подготовить подтверждение возврата'))
  await screen.findByLabelText('Новый код MFA')
  fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}})
  fireEvent.submit(screen.getByLabelText('Новый код MFA').closest('form'))
  await screen.findByText('Возврат выполнен.')
  expect(screen.queryByText(/Доступно для возврата: 2,00/)).toBeNull()
  expect(screen.getByText('Рассчитать сумму')).toBeDisabled()
  fireEvent.click(screen.getByText('Перейти к новому расчёту'))
  fireEvent.click(screen.getByText('Рассчитать сумму'))
  await screen.findByText(/Доступно для возврата: 1,00/)
  expect(api.confirmRefund).toHaveBeenCalledTimes(1)
 } finally { sessionStorage.clear() }
})
