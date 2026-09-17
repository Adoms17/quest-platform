import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: mocks }))
import { prepareBillingCommand, readBillingCommand, sendBillingCommand, loadBillingControls } from './billingControlsApi'
beforeEach(() => { sessionStorage.clear(); mocks.rpc.mockReset() })
it('сохраняет ключ при потере ответа и повторяет прежнюю revision', async () => {
  const command = prepareBillingCommand('actor', 'org', 3, 'cancel_renewal')
  mocks.rpc.mockResolvedValueOnce({ error: { message: 'network' } }).mockResolvedValueOnce({ data: { organization_id: 'org', revision: 4 } })
  await expect(sendBillingCommand('actor', 'org')).rejects.toBeTruthy()
  expect(readBillingCommand('actor', 'org')).toEqual(command)
  expect(() => prepareBillingCommand('actor', 'org', 4, 'resume_renewal')).toThrow()
  await sendBillingCommand('actor', 'org')
  expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1])
  expect(readBillingCommand('actor', 'org')).toBeNull()
})
it.each(['40001', '42501', '22023', 'P0001'])('определённый отказ %s освобождает команду', async code => {
  prepareBillingCommand('a', 'o', 1, 'cancel_renewal')
  mocks.rpc.mockResolvedValue({ error: { code } })
  await expect(sendBillingCommand('a', 'o')).rejects.toMatchObject({ code })
  expect(readBillingCommand('a', 'o')).toBeNull()
})
it('разделяет аккаунты и организации, сохраняет ключ при некорректном ответе', async () => {
  prepareBillingCommand('a', 'o', 1, 'cancel_renewal')
  expect(readBillingCommand('b', 'o')).toBeNull()
  expect(readBillingCommand('a', 'other')).toBeNull()
  mocks.rpc.mockResolvedValue({ data: { organization_id: 'other', revision: 2 } })
  await expect(sendBillingCommand('a', 'o')).rejects.toThrow()
  expect(readBillingCommand('a', 'o')).toBeTruthy()
})
it('не отправляет команду, если storage недоступен', () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage') })
  expect(() => prepareBillingCommand('a', 'o', 1, 'cancel_renewal')).toThrow()
  expect(mocks.rpc).not.toHaveBeenCalled()
  spy.mockRestore()
})
it('отклоняет ответ чужой организации', async () => {
  mocks.rpc.mockResolvedValue({ data: { organization_id: 'other' } })
  await expect(loadBillingControls('org')).rejects.toThrow()
})
it('сохраняет только команду повторной отправки, без снимка подписки из RPC', async () => {
  mocks.rpc.mockResolvedValue({ data: { organization_id: 'org', revision: 3,
    cancel_intent_state: 'none', scheduled_intent_state: 'none', can_request: true,
    can_manage: true, cancel_at_period_end: false, downgrade_targets: [],
    private_note: 'must-not-be-persisted' } })
  const controls = await loadBillingControls('org')
  const command = prepareBillingCommand('actor', 'org', controls.revision, 'cancel_renewal')
  const saved = sessionStorage.getItem('billing-command:actor:org')
  expect(JSON.parse(saved)).toEqual({ p_organization_id: 'org', p_command_id: command.p_command_id,
    p_expected_revision: 3, p_action: 'cancel_renewal', p_target_plan_version_id: null })
  expect(saved).not.toContain('must-not-be-persisted')
  expect(readBillingCommand('actor', 'org')).toEqual(command)
})
