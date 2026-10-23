import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../services/offlineReview', () => ({ listOfflineReviews: mocks.list }))
import OfflineEventReviews from './OfflineEventReviews'
beforeEach(() => vi.resetAllMocks())
it('загружает архив по запросу и явно отделяет его от начисленных результатов', async () => {
  mocks.list.mockResolvedValue([{ id: 'row', participant_name: 'Участник', received_at: '2026-09-16T00:00:00Z', payload: { eventType: 'answer', submittedValue: '<script>input</script>' } }])
  render(<OfflineEventReviews questId="quest" />)
  expect(mocks.list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Поздние офлайн-результаты' }))
  expect(await screen.findByText('Ответ: <script>input</script>')).toBeVisible()
  expect(screen.getByText(/В итоговую статистику не включены/)).toBeVisible()
  expect(mocks.list).toHaveBeenCalledWith('quest',null)
})
it('отказ загрузки не считается пустым архивом и допускает повтор', async () => {
  mocks.list.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce([])
  render(<OfflineEventReviews questId="quest" />)
  fireEvent.click(screen.getByRole('button', { name: 'Поздние офлайн-результаты' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByText('Нет результатов для проверки.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(screen.getByText('Нет результатов для проверки.')).toBeVisible())
})
