import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), context: {}, select: vi.fn() }))
vi.mock('../services/questWorkspaceApi', () => ({ getQuestWorkspace: mocks.get }))
vi.mock('../contexts/useOrganization', () => ({ useOrganization: () => mocks.context }))
import QuestWorkspaceNav from './QuestWorkspaceNav'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context = { organizations: [{ id: 'actual', name: 'Организация квеста', permissions: ['quest_stats.read'] }, { id: 'selected', permissions: ['quests.update', 'access_grants.manage'] }], currentOrganization: { id: 'selected' }, selectOrganization: mocks.select }
  mocks.get.mockResolvedValue({ id: 'q1', organization_id: 'actual', title: 'Маршрут' })
})
function setup() { return render(<MemoryRouter initialEntries={['/quests/q1/stats']}><QuestWorkspaceNav questId="q1" /></MemoryRouter>) }
it('использует права организации квеста и отмечает текущий раздел', async () => {
  setup()
  expect(await screen.findByRole('link', { name: 'Результаты' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('link', { name: 'Доступ' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Задания' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'К списку квестов' }))
  expect(mocks.select).toHaveBeenCalledWith('actual')
})
it('не показывает рабочие ссылки без членства', async () => {
  mocks.context.organizations = []
  setup()
  await act(async () => {})
  expect(screen.queryByRole('navigation')).toBeNull()
})
it('повторяет загрузку после ошибки', async () => {
  mocks.get.mockRejectedValueOnce(new Error('offline'))
  setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить навигацию' }))
  expect(await screen.findByRole('link', { name: 'Результаты' })).toBeVisible()
  expect(mocks.get).toHaveBeenCalledTimes(2)
})
it('отменяет запрос при уходе', async () => {
  let finish
  mocks.get.mockImplementation((id, signal) => new Promise(resolve => { finish = resolve; mocks.signal = signal }))
  const { unmount } = setup()
  unmount()
  expect(mocks.signal.aborted).toBe(true)
  await act(async () => finish({ id: 'q1', organization_id: 'actual', title: 'Поздний ответ' }))
  expect(screen.queryByText('Поздний ответ')).toBeNull()
})
