import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const revoke = vi.hoisted(() => vi.fn())
vi.mock('../services/teamApi', () => ({ revokeOrganizationInvitation: revoke }))
import OrganizationInvitationActions from './OrganizationInvitationActions'
const invitation = { id: 'i1', email: 'demo@example.test', status: 'pending', display_status: 'pending' }
beforeEach(() => { revoke.mockReset() })
it.each(['accepted','revoked','expired'])('не предлагает ссылку и отзыв в статусе %s', status => {
  render(<OrganizationInvitationActions invitation={{ ...invitation, display_status: status }} link="https://example.test/demo" />)
  expect(screen.queryByRole('button')).toBeNull()
})
it('подтверждение защищено от двойного нажатия', async () => {
  let finish
  revoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const refresh = vi.fn()
  render(<OrganizationInvitationActions invitation={invitation} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать приглашение' }))
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(revoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать приглашение' }))
  const confirm = screen.getByRole('button', { name: 'Подтвердить отзыв приглашения' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('i1')
  await act(async () => finish())
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('после ошибки предлагает обновить серверное состояние', async () => {
  revoke.mockRejectedValue({ code: '22023' })
  const refresh = vi.fn()
  render(<OrganizationInvitationActions invitation={invitation} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать приглашение' }))
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отзыв приглашения' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Подтвердить отзыв приглашения' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить приглашения' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('при отказе clipboard показывает поле ручного копирования', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  render(<OrganizationInvitationActions invitation={invitation} link="https://example.test/demo" />)
  fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }))
  expect((await screen.findByLabelText('Ссылка приглашения')).value).toBe('https://example.test/demo')
})
