import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const history = vi.hoisted(() => vi.fn())
vi.mock('../services/participantHistoryApi', () => ({ searchParticipantQuestHistory: history }))
vi.mock('../components/ParticipantProfileSearch', () => ({ default: ({ onChange }) => <button onClick={() => onChange('p2')}>Другой участник</button> }))
import ParticipantHistory from './ParticipantHistory'

beforeEach(() => { history.mockReset() })
const attempt = title => ({ items: [{ quest_attempt_id: title, quest_id: 'q1', quest_title: title, total_tasks: 1, finished_at: '2026-09-01T10:00:00Z' }], has_more: false, next_cursor: null })

it('передаёт профиль из ссылки и игнорирует позднюю историю прежнего участника', async () => {
  let finishOld
  history.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockResolvedValueOnce(attempt('Второй'))
  render(<MemoryRouter initialEntries={['/?participant=p1']}><ParticipantHistory /></MemoryRouter>)
  await waitFor(() => expect(history).toHaveBeenCalledWith('p1', null, expect.any(AbortSignal)))
  fireEvent.click(screen.getByText('Другой участник'))
  await screen.findByRole('heading', { name: 'Второй' })
  await act(async () => finishOld(attempt('Первый')))
  expect(screen.queryByRole('heading', { name: 'Первый' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Второй' })).toBeTruthy()
  expect(history.mock.calls[0][2].aborted).toBe(true)
})

it('сразу скрывает прежние результаты при смене участника', async () => {
  history.mockResolvedValueOnce(attempt('Первый')).mockImplementationOnce(() => new Promise(() => {}))
  render(<MemoryRouter initialEntries={['/?participant=p1']}><ParticipantHistory /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Первый' })
  fireEvent.click(screen.getByText('Другой участник'))
  expect(screen.queryByRole('heading', { name: 'Первый' })).toBeNull()
})

it('повторяет неудачную порцию с тем же курсором и не дублирует записи', async () => {
  const first = { ...attempt('Первый'), has_more: true, next_cursor: { id: 'cursor' } }
  history.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [...first.items, ...attempt('Второй').items], has_more: false })
  render(<MemoryRouter initialEntries={['/?participant=p1']}><ParticipantHistory /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё прохождения' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку следующей порции' }))
  await screen.findByRole('heading', { name: 'Второй' })
  expect(screen.getAllByRole('heading', { name: 'Первый' })).toHaveLength(1)
  expect(history.mock.calls[1][1]).toEqual(first.next_cursor)
  expect(history.mock.calls[2][1]).toEqual(first.next_cursor)
})

it('скрывает выданные страницы при отзыве доступа', async () => {
  history.mockResolvedValueOnce({ ...attempt('Первый'), has_more: true, next_cursor: { id: 'cursor' } })
    .mockRejectedValueOnce({ code: '42501' })
  render(<MemoryRouter initialEntries={['/?participant=p1']}><ParticipantHistory /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё прохождения' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('heading', { name: 'Первый' })).toBeNull()
})

it('отменяет следующую порцию при смене профиля', async () => {
  let finishPage
  history.mockResolvedValueOnce({ ...attempt('Первый'), has_more: true, next_cursor: { id: 'cursor' } })
    .mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve }))
    .mockResolvedValueOnce(attempt('Другой'))
  render(<MemoryRouter initialEntries={['/?participant=p1']}><ParticipantHistory /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё прохождения' }))
  fireEvent.click(screen.getByText('Другой участник'))
  await screen.findByRole('heading', { name: 'Другой' })
  await act(async () => finishPage(attempt('Поздний')))
  expect(screen.queryByRole('heading', { name: 'Поздний' })).toBeNull()
  expect(history.mock.calls[1][2].aborted).toBe(true)
})
