import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const { roles, revoke, save } = vi.hoisted(() => ({ roles: vi.fn(), revoke: vi.fn(), save: vi.fn() }))
vi.mock('../services/teamApi', () => ({ listAssignableOrganizationRoles: roles, revokeOrganizationMembership: revoke, setOrganizationMemberRoles: save }))
import OrganizationMemberActions from './OrganizationMemberActions'
const member = { id: 'm1', username: 'Саша', status: 'active', roles: [{ key: 'host', name: 'Ведущий' }] }
beforeEach(() => { vi.resetAllMocks(); roles.mockResolvedValue([{ key: 'host', name: 'Ведущий' }, { key: 'quest_editor', name: 'Редактор' }]) })
it.each([{ ...member, status: 'revoked' }, { ...member, roles: [{ key: 'owner' }] }])('не предлагает действия для защищённой записи %#', item => {
  render(<OrganizationMemberActions member={item} onRefresh={() => {}} />)
  expect(screen.queryByRole('button')).toBeNull(); expect(roles).not.toHaveBeenCalled()
})
it('заменяет роли только после проверки и подтверждения, без дубля', async () => {
  let finish
  save.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const refresh = vi.fn()
  render(<OrganizationMemberActions member={member} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Изменить роли' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Редактор' }))
  fireEvent.click(screen.getByRole('button', { name: 'Проверить изменения' }))
  expect(screen.getByText('Было: Ведущий')).toBeTruthy()
  expect(screen.getByText('Станет: Ведущий, Редактор')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  const confirm = screen.getByRole('button', { name: 'Подтвердить роли' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(save).toHaveBeenCalledExactlyOnceWith('m1', ['host', 'quest_editor'])
  await act(async () => finish())
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('отмена отзыва ничего не отправляет', () => {
  render(<OrganizationMemberActions member={member} onRefresh={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать доступ' }))
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(revoke).not.toHaveBeenCalled()
})
it('после потери ответа требует обновить команду', async () => {
  revoke.mockRejectedValue(new TypeError('Failed to fetch'))
  const refresh = vi.fn()
  render(<OrganizationMemberActions member={member} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать доступ' }))
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отзыв' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Подтвердить отзыв' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить команду' }))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('m1')
})
