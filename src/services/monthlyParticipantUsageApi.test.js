import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }))
import { loadMonthlyParticipantUsage } from './monthlyParticipantUsageApi'
const data = { organization_id: 'a', timezone: 'Europe/Moscow', is_partial: true, enforcement_enabled: false, participants: 3, period_start: '2026-08-31T21:00:00Z', period_end: '2026-09-30T21:00:00Z', measured_at: '2026-09-15T00:00:00Z', coverage_started_at: '2026-09-15T00:00:00Z' }
it('передаёт организацию и отмену запроса', async () => {
  const signal = new AbortController().signal, abortSignal = vi.fn().mockResolvedValue({ data })
  mocks.rpc.mockReturnValue({ abortSignal })
  expect(await loadMonthlyParticipantUsage('a',signal)).toEqual(data)
  expect(abortSignal).toHaveBeenCalledWith(signal)
  expect(mocks.rpc).toHaveBeenCalledWith('get_monthly_participant_usage',{ p_organization_id: 'a' })
})
it.each([{ organization_id: 'b' },{ participants: -1 },{ period_end: 'invalid' },{ enforcement_enabled: true }])('отклоняет неверный ответ %j', async override => {
  mocks.rpc.mockResolvedValue({ data: { ...data,...override } })
  await expect(loadMonthlyParticipantUsage('a')).rejects.toThrow('Некорректный ответ')
})
