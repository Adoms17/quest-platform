import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const api = vi.hoisted(() => ({ readRecurringConsent: vi.fn(), requestRecurringConsent: vi.fn(), revokeRecurringConsent: vi.fn() }))
vi.mock('../services/recurringConsentApi', () => api)
import RecurringConsent from './RecurringConsent'
beforeEach(() => { vi.resetAllMocks(); api.readRecurringConsent.mockResolvedValue({ state: 'none', canRequest: true }) })

test.each(['resolve', 'reject'])('позднее начальное чтение (%s) не отменяет подтверждённый отзыв', async outcome => {
  let resolveInitial, rejectInitial
  api.readRecurringConsent.mockImplementationOnce(() => new Promise((resolve, reject) => {
    resolveInitial = resolve; rejectInitial = reject
  })).mockResolvedValue({ state: 'saved', consentId: 'consent', canRequest: false })
  api.revokeRecurringConsent.mockResolvedValue({ state: 'revoked', consentId: 'consent', canRequest: false })
  render(<RecurringConsent organizationId="org" orderId="order" />)
  fireEvent.click(screen.getByRole('button', { name: 'Обновить согласие' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Отозвать согласие' }))
  const revoked = 'Согласие отозвано. Следующие списания по нему запрещены. Уже начатый платёж требует проверки.'
  await screen.findByText(revoked)
  await act(async () => outcome === 'resolve'
    ? resolveInitial({ state: 'none', canRequest: true })
    : rejectInitial(new Error('stale initial request')))
  expect(screen.getByText(revoked)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(api.revokeRecurringConsent).toHaveBeenCalledTimes(1)
  expect(api.requestRecurringConsent).not.toHaveBeenCalled()
})

test('повторное открытие отозванного согласия не предлагает новый платёж или отмену начатого', async () => {
  api.readRecurringConsent.mockResolvedValue({ state: 'revoked', consentId: 'consent', canRequest: false })
  render(<RecurringConsent organizationId="org" orderId="order" />)
  await screen.findByText('Согласие отозвано. Следующие списания по нему запрещены. Уже начатый платёж требует проверки.')
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Сохранить согласие' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Отозвать согласие' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить согласие' }))
  await waitFor(() => expect(api.readRecurringConsent).toHaveBeenCalledTimes(2))
  expect(api.requestRecurringConsent).not.toHaveBeenCalled()
  expect(api.revokeRecurringConsent).not.toHaveBeenCalled()
})
test('требует явное согласие и защищает от двойного клика', async () => {
  api.requestRecurringConsent.mockReturnValue(new Promise(() => {}))
  render(<RecurringConsent organizationId="org" orderId="order" />)
  const button = await screen.findByRole('button', { name: 'Сохранить согласие' })
  expect(button).toBeDisabled()
  expect(api.requestRecurringConsent).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button); fireEvent.click(button)
  expect(api.requestRecurringConsent).toHaveBeenCalledTimes(1)
})
test('показывает сохранённое состояние и отзыв без обещания списаний', async () => {
  api.readRecurringConsent.mockResolvedValue({ state: 'saved', consentId: 'consent', canRequest: false })
  api.revokeRecurringConsent.mockResolvedValue({ state: 'revoked', consentId: 'consent', canRequest: false })
  render(<RecurringConsent organizationId="org" orderId="order" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Отозвать согласие' }))
  await screen.findByText('Согласие отозвано. Следующие списания по нему запрещены. Уже начатый платёж требует проверки.')
  expect(api.revokeRecurringConsent).toHaveBeenCalledWith('org', 'order', 'consent')
  expect(screen.queryByRole('checkbox')).toBeNull()
})
test('сбой после записи восстанавливается чтением, без вывода исходной ошибки', async () => {
  api.requestRecurringConsent.mockRejectedValue(new Error('private-provider-detail'))
  render(<RecurringConsent organizationId="org" orderId="order" />)
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить согласие' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('private-provider-detail')).toBeNull()
  api.readRecurringConsent.mockResolvedValue({ state: 'pending', consentId: 'consent', canRequest: false })
  fireEvent.click(screen.getByRole('button', { name: 'Обновить согласие' }))
  await screen.findByText('Согласие сохранено. Способ оплаты ещё не подтверждён.')
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

test('смена заказа сбрасывает галочку и не принимает поздний ответ предыдущего заказа', async () => {
  let finishOldRequest
  api.requestRecurringConsent.mockReturnValue(new Promise(resolve => { finishOldRequest = resolve }))
  const { rerender } = render(<RecurringConsent organizationId="org" orderId="first" />)
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить согласие' }))
  rerender(<RecurringConsent organizationId="org" orderId="second" />)
  expect(await screen.findByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Сохранить согласие' })).toBeDisabled()
  await act(async () => finishOldRequest({ state: 'saved', canRequest: false, consentId: 'old' }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.queryByRole('button', { name: 'Отозвать согласие' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox'))
  api.requestRecurringConsent.mockResolvedValue({ state: 'pending', canRequest: false, consentId: 'new' })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить согласие' }))
  await screen.findByText('Согласие сохранено. Способ оплаты ещё не подтверждён.')
  expect(api.requestRecurringConsent).toHaveBeenLastCalledWith('org', 'second')
})
