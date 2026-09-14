import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const clear = vi.hoisted(() => vi.fn())
vi.mock('../services/questResultsApi', () => ({ clearQuestResults: clear }))
import QuestResultsMaintenance from './QuestResultsMaintenance'
beforeEach(() => { clear.mockReset() })
function setup() {
  const refresh = vi.fn()
  render(<QuestResultsMaintenance questId="q1" onRefresh={refresh} />)
  fireEvent.click(screen.getByText('Обслуживание статистики'))
  fireEvent.click(screen.getByRole('button', { name: 'Очистить статистику' }))
  return refresh
}
it('отмена не вызывает удаление', () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(clear).not.toHaveBeenCalled()
})
it('не выдаёт нулевой результат RLS за успешное удаление', async () => {
  clear.mockResolvedValue(0)
  const refresh = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить удаление всех результатов' }))
  await screen.findByText(/Удаление записей не подтверждено/)
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('двойное нажатие отправляет одно удаление в нужный квест', async () => {
  let finish
  clear.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  setup()
  const button = screen.getByRole('button', { name: 'Подтвердить удаление всех результатов' })
  fireEvent.click(button); fireEvent.click(button)
  expect(clear).toHaveBeenCalledExactlyOnceWith('q1')
  await act(async () => finish(2))
  expect(screen.getByText('Удалено серверных прохождений: 2.')).toBeTruthy()
})
