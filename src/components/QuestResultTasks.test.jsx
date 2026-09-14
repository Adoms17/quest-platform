import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const load = vi.hoisted(() => vi.fn())
vi.mock('../services/questResultsApi', () => ({ loadQuestResultTasks: load }))
import QuestResultTasks from './QuestResultTasks'
beforeEach(() => { load.mockReset() })
it('загружает только при раскрытии и отменяет скрытую загрузку', async () => {
  let finish
  load.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<QuestResultTasks questId="q1" attemptId="a1" />)
  expect(load).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Показать задания' }))
  expect(load.mock.calls[0].slice(0, 3)).toEqual(['q1', 'a1', null])
  const signal = load.mock.calls[0][3]
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть задания' }))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ items: [{ id: 't1', tasks: { title: 'Поздний ответ' } }], hasMore: false }))
  expect(screen.queryByText('Поздний ответ')).toBeNull()
})
it('после отказа догрузки убирает показанные данные', async () => {
  load.mockResolvedValueOnce({ items: [{ id: 't1', tasks: { title: 'Задание' } }], hasMore: true, cursor: 't1' }).mockRejectedValueOnce({ code: '42501' })
  render(<QuestResultTasks questId="q1" attemptId="a1" />)
  fireEvent.click(screen.getByRole('button'))
  await screen.findByText('Задание')
  fireEvent.click(screen.getByRole('button', { name: 'Ещё задания' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('Задание')).toBeNull()
})
