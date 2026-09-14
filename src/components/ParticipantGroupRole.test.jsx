import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const change = vi.hoisted(() => vi.fn())
vi.mock('../services/peopleCatalogApi', () => ({ changeGroupMemberRole: change }))
import ParticipantGroupRole from './ParticipantGroupRole'
beforeEach(() => { change.mockReset() })
const setup = () => {
  const refresh = vi.fn()
  render(<ParticipantGroupRole groupId="g1" member={{ id: 'p1', display_name: 'Участник', member_role: 'member' }} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Изменить роль' }))
  return refresh
}
it('отмена не меняет роль', () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(change).not.toHaveBeenCalled()
})
it('отправляет одно подтверждение с ожидаемой ролью', async () => {
  let finish
  change.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const refresh = setup()
  const button = screen.getByRole('button', { name: 'Подтвердить роль' })
  fireEvent.click(button); fireEvent.click(button)
  expect(change).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenCalledWith('g1','p1','member','leader')
  await act(async () => finish())
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('конфликт требует обновления состава', async () => {
  change.mockRejectedValue({ code: '40001' })
  const refresh = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить роль' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Подтвердить роль' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Проверить состав' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})
