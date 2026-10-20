import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../services/monthlyParticipantUsageApi', () => ({ loadMonthlyParticipantUsage: mocks.load }))
import MonthlyParticipantUsage from './MonthlyParticipantUsage'
const fixture = participants => ({ participants, period_start: '2026-08-31T21:00:00Z', period_end: '2026-09-30T21:00:00Z', coverage_started_at: '2026-09-15T00:00:00Z', measured_at: '2026-09-15T00:00:00Z', is_partial: true })
beforeEach(() => mocks.load.mockReset())
it('показывает неполное покрытие и неизвестный расход без ложного нуля', async () => {
  mocks.load.mockResolvedValue(fixture(null))
  render(<MonthlyParticipantUsage organizationId="a" />)
  await screen.findByText('Нет данных')
  expect(screen.getByText(/Данные за месяц неполные/)).toBeTruthy()
  expect(screen.getByText(/01.09.2026/)).toBeTruthy()
})
it('не показывает поздний ответ другой организации', async () => {
  let resolve
  mocks.load.mockImplementationOnce(() => new Promise(r => { resolve=r })).mockResolvedValueOnce(fixture(7))
  const { rerender } = render(<MonthlyParticipantUsage organizationId="a" />)
  const signal = mocks.load.mock.calls[0][1]
  rerender(<MonthlyParticipantUsage organizationId="b" />)
  await screen.findByText('7')
  await act(async () => resolve(fixture(99)))
  expect(signal.aborted).toBe(true)
  expect(screen.queryByText('99')).toBeNull()
})
it('повторяет запрос после ошибки без серверных подробностей', async () => {
  mocks.load.mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(fixture(0))
  render(<MonthlyParticipantUsage organizationId="a" />)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку участников' }))
  await screen.findByText('0')
  expect(screen.queryByText('private')).toBeNull()
})
