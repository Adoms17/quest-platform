import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const add = vi.hoisted(() => vi.fn())
vi.mock('../services/peopleCatalogApi', () => ({ addParticipantGroupMember: add }))
vi.mock('../hooks/usePeopleCatalog', () => ({ usePeopleCatalog: () => ({ items: [{ id: 'p1', display_name: 'Участник', can_participate: true }], hasMore: false }) }))
import ParticipantGroupAddMember from './ParticipantGroupAddMember'
beforeEach(() => { add.mockReset() })
function setup() {
  const onComplete = vi.fn()
  render(<ParticipantGroupAddMember actorId="u1" groupId="g1" onComplete={onComplete} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Участник\s*Доступный профиль/ }))
  return { form: screen.getByRole('button', { name: 'Добавить выбранного' }).closest('form'), onComplete }
}
it('выбор сам по себе не меняет состав, двойной submit отправляет один запрос', async () => {
  let finish
  add.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { form, onComplete } = setup()
  expect(add).not.toHaveBeenCalled()
  fireEvent.submit(form); fireEvent.submit(form)
  expect(add).toHaveBeenCalledTimes(1)
  expect(add).toHaveBeenCalledWith('g1', 'p1')
  await act(async () => finish())
  expect(onComplete).toHaveBeenCalledWith('Участник')
})
it('при потере ответа предлагает проверить состав без повторной мутации', async () => {
  add.mockRejectedValue(new TypeError('Failed to fetch'))
  const { form, onComplete } = setup()
  fireEvent.submit(form)
  const check = await screen.findByRole('button', { name: 'Проверить состав' })
  fireEvent.submit(form)
  expect(add).toHaveBeenCalledTimes(1)
  fireEvent.click(check)
  expect(onComplete).toHaveBeenCalledWith()
})
it('серверный отказ не сообщает об успехе', async () => {
  add.mockRejectedValue({ code: '42501', message: 'participant group management denied' })
  const { form, onComplete } = setup()
  fireEvent.submit(form)
  await screen.findByRole('alert')
  expect(onComplete).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Добавить выбранного' })).toBeEnabled()
})
