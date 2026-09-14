import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: {}, catalog: vi.fn() }))
vi.mock('../contexts/useOrganization', () => ({ useOrganization: () => mocks.context }))
vi.mock('../hooks/useTeamCatalog', () => ({ useTeamCatalog: mocks.catalog }))
import OrganizationTeam from './OrganizationTeam'
beforeEach(() => {
  mocks.context = { currentOrganization: { id: 'o1', name: 'Организация', permissions: ['members.read'] } }
  mocks.catalog.mockReset().mockReturnValue({ items: [], loading: false, hasMore: false })
})
it('читатель видит сотрудников без приглашений и управления', () => {
  render(<OrganizationTeam session={{ user: { id: 'a1' } }} />)
  expect(screen.getByRole('button', { name: 'Сотрудники' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Приглашения' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Управление и журнал' })).toBeNull()
  expect(mocks.catalog).toHaveBeenCalledWith('a1', 'o1', 'members', 'active', '', 0)
})
it('смена организации сбрасывает поисковый контекст', () => {
  const { rerender } = render(<OrganizationTeam session={{ user: { id: 'a1' } }} />)
  fireEvent.change(screen.getByLabelText('Найти по имени или email'), { target: { value: 'Саша' } })
  mocks.context.currentOrganization = { id: 'o2', name: 'Вторая', permissions: ['members.read'] }
  rerender(<OrganizationTeam session={{ user: { id: 'a1' } }} />)
  expect(screen.getByLabelText('Найти по имени или email').value).toBe('')
  expect(mocks.catalog).toHaveBeenLastCalledWith('a1', 'o2', 'members', 'active', '', 0)
})
it('без разрешений каталог не запрашивается', () => {
  mocks.context.currentOrganization.permissions = []
  render(<OrganizationTeam session={{ user: { id: 'a1' } }} />)
  expect(mocks.catalog).not.toHaveBeenCalled()
  expect(screen.getByText('Нет доступа к команде организации.')).toBeTruthy()
})
