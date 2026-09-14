import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const change = vi.hoisted(() => vi.fn())
vi.mock('../services/participantGroupApi', () => ({ setMyParticipantSupervisionStatus: change }))
import ParticipantSupervisionControl from './ParticipantSupervisionControl'
beforeEach(() => { change.mockReset() })
const setup = (status = 'active') => {
  const refresh = vi.fn()
  const view = render(<ParticipantSupervisionControl profile={{ id: 'p1', display_name: 'Участник', supervision_status: status }} onRefresh={refresh} />)
  return { refresh, ...view }
}
it('не предлагает управление отсутствующей или отозванной связью', () => {
  const { unmount } = setup('revoked')
  expect(screen.queryByRole('button')).toBeNull()
  unmount()
  setup(null)
  expect(screen.queryByRole('button')).toBeNull()
})
it('отмена не вызывает запрос', () => {
  setup()
  fireEvent.click(screen.getByText('Приостановить мой контроль'))
  fireEvent.click(screen.getByText('Отмена'))
  expect(change).not.toHaveBeenCalled()
})
it('отправляет один запрос и обновляет карточку после серверного успеха', async () => {
  let finish
  change.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { refresh } = setup()
  fireEvent.click(screen.getByText('Приостановить мой контроль'))
  const button = screen.getByText('Подтвердить изменение контроля')
  fireEvent.click(button); fireEvent.click(button)
  expect(change).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenCalledWith('p1', 'suspended')
  expect(refresh).not.toHaveBeenCalled()
  await act(async () => finish())
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('после неопределённого результата требует проверки перед повтором', async () => {
  change.mockRejectedValue(new Error('network'))
  const { refresh } = setup('suspended')
  fireEvent.click(screen.getByText('Возобновить мой контроль'))
  fireEvent.click(screen.getByText('Подтвердить изменение контроля'))
  await screen.findByRole('alert')
  expect(change).toHaveBeenCalledWith('p1', 'active')
  expect(screen.queryByText('Подтвердить изменение контроля')).toBeNull()
  fireEvent.click(screen.getByText('Проверить профиль'))
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('поздний ответ после ухода с карточки не обновляет другой профиль', async () => {
  let finish
  change.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { refresh, unmount } = setup()
  fireEvent.click(screen.getByText('Приостановить мой контроль'))
  fireEvent.click(screen.getByText('Подтвердить изменение контроля'))
  unmount()
  await act(async () => finish())
  expect(refresh).not.toHaveBeenCalled()
})
