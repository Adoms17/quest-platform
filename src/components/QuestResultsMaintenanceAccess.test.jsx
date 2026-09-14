import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const check = vi.hoisted(() => vi.fn())
vi.mock('../services/questResultsApi', () => ({ canClearQuestResults: check }))
vi.mock('./QuestResultsMaintenance', () => ({ default: () => <div>Очистка</div> }))
import QuestResultsMaintenanceAccess from './QuestResultsMaintenanceAccess'
beforeEach(() => { check.mockReset() })
const view = props => <QuestResultsMaintenanceAccess actorId="a1" questId="q1" revision={0} {...props} />
it('показывает очистку только после положительного ответа для квеста', async () => {
  let resolve
  check.mockImplementation(() => new Promise(done => { resolve = done }))
  render(view())
  expect(screen.queryByText('Очистка')).toBeNull()
  expect(check).toHaveBeenCalledWith('q1', expect.any(AbortSignal))
  await act(async () => resolve(true))
  expect(screen.getByText('Очистка')).toBeTruthy()
})
it.each([false, new Error('offline')])('скрывает очистку при отказе или ошибке: %s', async value => {
  if (value instanceof Error) check.mockRejectedValue(value)
  else check.mockResolvedValue(value)
  render(view())
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Очистка')).toBeNull()
})
it('не проверяет право без аккаунта', () => {
  render(view({ actorId: null }))
  expect(check).not.toHaveBeenCalled()
})
it('сбрасывает доступ при обновлении и игнорирует ответ прежнего аккаунта', async () => {
  let resolve
  check.mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValueOnce(false)
  const { rerender } = render(view())
  await screen.findByText('Очистка')
  rerender(view({ revision: 1 }))
  expect(screen.queryByText('Очистка')).toBeNull()
  const signal = check.mock.calls[1][1]
  rerender(view({ actorId: 'a2', questId: 'q2', revision: 1 }))
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(true))
  expect(screen.queryByText('Очистка')).toBeNull()
})
