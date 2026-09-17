import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: {}, load: vi.fn() }))
vi.mock('../contexts/useOrganization', () => ({ useOrganization: () => mocks.context }))
vi.mock('../services/organizationBillingApi', () => ({ loadOrganizationBilling: mocks.load }))
vi.mock('../components/MonthlyParticipantUsage', () => ({ default: () => null }))
vi.mock('../components/BillingIntentControls', () => ({ default: () => null }))
import OrganizationBilling from './OrganizationBilling'
const session = { user: { id: 'actor' } }
const data = name => ({ status: 'transition', configured_plan: { name }, can_manage: false, usage: { active_quests: 3, team_members: 2 }, enforcement: { active_quests: false, team_members: false }, effective_entitlements: null, measured_at: '2026-09-15T00:00:00Z' })
beforeEach(() => {
  mocks.context = { currentOrganization: { id: 'a', name: 'Первая', permissions: ['billing.read'] } }
  mocks.load.mockReset()
})
it('при включённой квоте команды предлагает освободить место сотруднику', async () => {
  mocks.load.mockResolvedValue({ ...data('Free'), status: 'free', effective_entitlements: { active_quests: 1, team_members: 1 }, enforcement: { active_quests: false, team_members: true } })
  render(<OrganizationBilling session={session} />)
  await screen.findByText('Лимит команды достигнут. Для нового сотрудника нужно освободить место.')
  expect(screen.queryByText('Лимит достигнут. Для открытия квеста закройте другой.')).toBeNull()
})
it.each([
  ['unconfigured', 'Тариф ещё не настроен.'],
  ['missing', 'Данные подписки недоступны. Обратитесь к владельцу организации.'],
  ['invalid', 'Тариф требует проверки. Обратитесь к владельцу организации.'],
  ['not_started', 'Период подписки ещё не начался.'],
])('%s не подменяется бесплатным тарифом или действующими лимитами', async (status, message) => {
  mocks.load.mockResolvedValue({ ...data(null), status })
  render(<OrganizationBilling session={session} />)
  await screen.findByText(message)
  expect(screen.queryByText('Бесплатный тариф')).toBeNull()
  expect(screen.queryByText(/из .* по тарифу/)).toBeNull()
  expect(screen.getByText('Тариф не назначен')).toBeTruthy()
})
it.each([['trial', 'Бесплатный доступ по платному тарифу'], ['active', 'Подписка активна']])('%s показывает серверные даты и лимиты', async (status, message) => {
  const start = '2026-09-15T00:00:00Z', end = '2026-10-15T00:00:00Z'
  mocks.load.mockResolvedValue({ ...data('Pro'), status, period_start: start, period_end: end,
    effective_entitlements: { active_quests: 5, team_members: 3 }, enforcement: { active_quests: true, team_members: false } })
  render(<OrganizationBilling session={session} />)
  await screen.findByText(message)
  expect(screen.getByText(`Начало периода: ${new Date(start).toLocaleString('ru-RU')}`)).toBeTruthy()
  expect(screen.getByText(`Конец периода: ${new Date(end).toLocaleString('ru-RU')}`)).toBeTruthy()
  expect(screen.getByText('из 5 по тарифу')).toBeTruthy()
  expect(screen.getByText('Лимит применяется.')).toBeTruthy()
  expect(screen.getByText('Вам доступен просмотр тарифа. Управляет подпиской владелец организации.')).toBeTruthy()
})
it('отменяет запрос предыдущей организации и игнорирует поздний ответ', async () => {
  let resolveA
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve })).mockResolvedValueOnce(data('Тариф Б'))
  const { rerender } = render(<OrganizationBilling session={session} />)
  const signal = mocks.load.mock.calls[0][1]
  mocks.context.currentOrganization = { ...mocks.context.currentOrganization, id: 'b', name: 'Вторая' }
  rerender(<OrganizationBilling session={session} />)
  expect(signal.aborted).toBe(true)
  await screen.findByText('Тариф Б')
  await act(async () => resolveA(data('Тариф А')))
  expect(screen.queryByText('Тариф А')).toBeNull()
  expect(screen.getByText('Тариф Б')).toBeTruthy()
})
it('не запрашивает тариф без billing.read', () => {
  mocks.context.currentOrganization.permissions = []
  render(<OrganizationBilling session={session} />)
  expect(mocks.load).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('Нет доступа')
})
it('смена аккаунта скрывает предыдущий снимок и отменяет запрос', async () => {
  mocks.load.mockResolvedValueOnce(data('Старый тариф')).mockReturnValueOnce(new Promise(() => {}))
  const { rerender } = render(<OrganizationBilling session={session} />)
  await screen.findByText('Старый тариф')
  const signal = mocks.load.mock.calls[0][1]
  rerender(<OrganizationBilling session={{ user: { id: 'other' } }} />)
  expect(signal.aborted).toBe(true)
  expect(screen.queryByText('Старый тариф')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Загрузка тарифа…')
})
it('отзыв права чтения убирает уже загруженные данные', async () => {
  mocks.load.mockResolvedValue(data('Приватный тариф'))
  const { rerender } = render(<OrganizationBilling session={session} />)
  await screen.findByText('Приватный тариф')
  mocks.context.currentOrganization.permissions = []
  rerender(<OrganizationBilling session={session} />)
  expect(screen.queryByText('Приватный тариф')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('Нет доступа')
})
it('показывает безопасный отказ сервера и позволяет повторить', async () => {
  mocks.load.mockRejectedValueOnce({ code: '42501', message: 'private details' }).mockResolvedValueOnce(data('Тариф'))
  render(<OrganizationBilling session={session} />)
  expect((await screen.findByRole('alert')).textContent).toBe('Нет доступа к тарифу организации.')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByText('Тариф')
  expect(screen.getAllByText('Ограничение пока не применяется.')).toHaveLength(2)
  expect(screen.queryByText(/private details/)).toBeNull()
})

it('показывает серверный grace и прежние лимиты', async () => {
  const end = '2026-09-20T00:00:00Z'
  mocks.load.mockResolvedValue({ ...data('Pro'), status: 'grace', grace_end: end,
    effective_entitlements: { active_quests: 5, team_members: 3 }, enforcement: { active_quests: true, team_members: true } })
  render(<OrganizationBilling session={session} />)
  await screen.findByText('Льготный период. Возможности тарифа временно сохранены.')
  expect(screen.getByText(`Льготный период до: ${new Date(end).toLocaleString('ru-RU')}`)).toBeTruthy()
  expect(screen.getByText('из 5 по тарифу')).toBeTruthy()
  expect(screen.queryByText('Подписка активна')).toBeNull()
})
