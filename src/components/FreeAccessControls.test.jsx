import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => Object.fromEntries(['getTrialBrowserHash', 'loadFreeAccessControls', 'readFreeAccessCommand', 'prepareFreeAccessCommand', 'sendFreeAccessCommand'].map(k => [k, vi.fn()])))
vi.mock('../services/freeAccessApi', () => mocks)
import FreeAccessControls from './FreeAccessControls'
const data = { revision: 1, available: true, targets: [{ id: 'pro', name: 'Pro', days: 14, eligible: true, active_quests: 5, team_members: 3 }] }
beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset())
  mocks.getTrialBrowserHash.mockResolvedValue('a'.repeat(64)); mocks.readFreeAccessCommand.mockReturnValue(null)
  mocks.loadFreeAccessControls.mockResolvedValue(data)
  mocks.sendFreeAccessCommand.mockResolvedValue({ starts_at: '2026-09-16T00:00:00Z', ends_at: '2026-09-30T00:00:00Z' })
})
it('выбор и просмотр не активируют trial, требуется явное подтверждение', async () => {
  render(<FreeAccessControls actorId="a" organizationId="o" />)
  fireEvent.change(await screen.findByLabelText('Тариф для пробного доступа'), { target: { value: 'pro' } })
  fireEvent.click(screen.getByText('Посмотреть условия trial'))
  expect(mocks.sendFreeAccessCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Подтвердить бесплатный доступ'))
  await waitFor(() => expect(mocks.sendFreeAccessCommand).toHaveBeenCalledTimes(1))
  expect(mocks.prepareFreeAccessCommand).toHaveBeenCalledWith('a', 'o', 1, 'trial', { target: 'pro', browserHash: 'a'.repeat(64) })
})
it('старой формы активации промокода нет', async () => {
  render(<FreeAccessControls actorId="a" organizationId="o" />)
  await screen.findByLabelText('Тариф для пробного доступа')
  expect(screen.queryByLabelText('Промокод')).not.toBeInTheDocument()
})
it('pending блокирует новую активацию и восстанавливает старую команду', async () => {
  mocks.readFreeAccessCommand.mockReturnValue({ kind: 'trial' })
  render(<FreeAccessControls actorId="a" organizationId="o" />)
  fireEvent.click(await screen.findByText('Проверить и повторить запрос'))
  await waitFor(() => expect(mocks.sendFreeAccessCommand).toHaveBeenCalledWith('a', 'o'))
  expect(mocks.prepareFreeAccessCommand).not.toHaveBeenCalled()
})
it('старый промозапрос показан без кнопки повторной активации', async () => {
  mocks.readFreeAccessCommand.mockReturnValue({ kind: 'retired_promotion' })
  render(<FreeAccessControls actorId="a" organizationId="o" />)
  await screen.findByText(/Старый запрос промодоступа сохранён/)
  expect(screen.queryByText('Проверить и повторить запрос')).not.toBeInTheDocument()
  expect(mocks.sendFreeAccessCommand).not.toHaveBeenCalled()
})
