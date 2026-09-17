import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ loadBillingControls: vi.fn(), prepareBillingCommand: vi.fn(), readBillingCommand: vi.fn(), sendBillingCommand: vi.fn() }))
vi.mock('../services/billingControlsApi', () => mocks)
import BillingIntentControls from './BillingIntentControls'
const state = { revision: 1, can_manage: true, can_request: true, cancel_at_period_end: false, scheduled_plan_version_id: null, downgrade_targets: [{ id: 'free', name: 'Free', version: 1, active_quests: 1, team_members: 1 }] }
beforeEach(() => { Object.values(mocks).forEach(m => m.mockReset()); mocks.readBillingCommand.mockReturnValue(null); mocks.loadBillingControls.mockResolvedValue(state); mocks.sendBillingCommand.mockResolvedValue({}) })
it('подтверждает downgrade и перечитывает сервер вместо optimistic update', async () => {
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  fireEvent.change(await screen.findByLabelText('Тариф со следующего периода'), { target: { value: 'free' } })
  fireEvent.click(screen.getByRole('button', { name: 'Запросить смену тарифа' }))
  expect(mocks.sendBillingCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Подтвердить запрос'))
  await waitFor(() => expect(mocks.loadBillingControls).toHaveBeenCalledTimes(2))
  expect(mocks.prepareBillingCommand).toHaveBeenCalledWith('a', 'o', 1, 'schedule_downgrade', 'free')
})
it('только просмотр не показывает действия', async () => {
  mocks.loadBillingControls.mockResolvedValue({ ...state, can_manage: false, can_request: false })
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  await screen.findByText('Вам доступен только просмотр запросов.')
  expect(screen.queryByText('Запросить отмену продления')).toBeNull()
})
it('конфликт обновляет состояние и требует нового выбора', async () => {
  mocks.sendBillingCommand.mockRejectedValue({ code: '40001' })
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  fireEvent.click(await screen.findByText('Запросить отмену продления'))
  fireEvent.click(screen.getByText('Подтвердить запрос'))
  await screen.findByText('Подписка изменилась. Проверьте новые условия и выберите действие заново.')
  await waitFor(() => expect(screen.queryByText('Подтвердить запрос')).toBeNull())
})
it('pending восстанавливает повтор, блокируя новые действия', async () => {
  mocks.readBillingCommand.mockReturnValue({ p_action: 'cancel_renewal' })
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  fireEvent.click(await screen.findByText('Проверить и повторить запрос'))
  await waitFor(() => expect(mocks.sendBillingCommand).toHaveBeenCalledWith('a', 'o'))
  expect(mocks.prepareBillingCommand).not.toHaveBeenCalled()
})
it('stale предлагает снять намерение, не подменяя его действующим', async () => {
  mocks.loadBillingControls.mockResolvedValue({ ...state, cancel_at_period_end: true, cancel_intent_state: 'stale' })
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  await screen.findByText(/Прежний запрос устарел/)
  expect(screen.getByText('Снять запрос отмены')).toBeTruthy()
  expect(screen.queryByText('Запросить отмену продления')).toBeNull()
})
it('истёкший период не разрешает новые запросы', async () => {
  mocks.loadBillingControls.mockResolvedValue({ ...state, can_request: false })
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  await screen.findByText('Новые запросы доступны только в действующем платном периоде.')
  expect(screen.queryByText('Запросить отмену продления')).toBeNull()
})
it('двойное подтверждение не отправляет две команды', async () => {
  mocks.sendBillingCommand.mockReturnValue(new Promise(() => {}))
  render(<BillingIntentControls actorId="a" organizationId="o" />)
  fireEvent.click(await screen.findByText('Запросить отмену продления'))
  const confirm = screen.getByText('Подтвердить запрос')
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  expect(mocks.sendBillingCommand).toHaveBeenCalledTimes(1)
})
