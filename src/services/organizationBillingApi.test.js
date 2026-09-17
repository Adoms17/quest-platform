import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }))
import { loadOrganizationBilling } from './organizationBillingApi'
const valid = () => ({ organization_id: 'a', status: 'free', can_manage: true, measured_at: '2026-09-15T00:00:00Z', usage: { active_quests: 1, team_members: 1 }, enforcement: { active_quests: true, team_members: false }, effective_entitlements: { active_quests: 1, team_members: 1 } })
beforeEach(() => mocks.rpc.mockReset())
it('передаёт идентификатор и сигнал отмены общему RPC', async () => {
  const data = valid(), signal = new AbortController().signal
  const abortSignal = vi.fn().mockResolvedValue({ data })
  mocks.rpc.mockReturnValue({ abortSignal })
  expect(await loadOrganizationBilling('a', signal)).toEqual(data)
  expect(abortSignal).toHaveBeenCalledWith(signal)
  expect(mocks.rpc).toHaveBeenCalledWith('get_organization_billing_overview', { p_organization_id: 'a' })
})
it.each([
  { organization_id: 'b' }, { usage: { active_quests: -1, team_members: 1 } },
  { effective_entitlements: {} }, { measured_at: 'invalid' },
])('отклоняет чужой или неполный ответ %j', async override => {
  mocks.rpc.mockResolvedValue({ data: { ...valid(), ...override } })
  await expect(loadOrganizationBilling('a')).rejects.toThrow('Некорректный ответ')
})
it('сохраняет серверную ошибку доступа', async () => {
  const error = { code: '42501' }
  mocks.rpc.mockResolvedValue({ error })
  await expect(loadOrganizationBilling('a')).rejects.toBe(error)
})
