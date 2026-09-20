import { beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }))
import { getTrialBrowserHash, prepareFreeAccessCommand, readFreeAccessCommand, sendFreeAccessCommand } from './freeAccessApi'
const receipt = { organization_id: 'o', access_id: 'g', state: 'active', starts_at: '2026-09-16T00:00:00Z', ends_at: '2026-09-30T00:00:00Z' }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear(); mocks.rpc.mockReset() })
it('метка сохраняется между сеансами и не зависит от аккаунта', async () => {
  const first = await getTrialBrowserHash()
  sessionStorage.clear()
  expect(await getTrialBrowserHash()).toBe(first)
  expect(first).toMatch(/^[0-9a-f]{64}$/)
})
it('повреждённая метка не заменяется новой', async () => {
  localStorage.setItem('qvesta:trial-browser:v1', 'invalid')
  await expect(getTrialBrowserHash()).rejects.toThrow('метку')
  expect(localStorage.getItem('qvesta:trial-browser:v1')).toBe('invalid')
})
it('восстанавливает подтверждённый trial без повторной активации', async () => {
  await prepareFreeAccessCommand('a', 'o', 1, 'trial', { target: 'p', browserHash: 'a'.repeat(64) })
  expect(sessionStorage.getItem('free-access-command:a:o')).not.toContain('SECRET-CODE')
  mocks.rpc.mockResolvedValue({ data: { organization_id: 'o', found: true, receipt } })
  expect(await sendFreeAccessCommand('a', 'o')).toEqual(receipt)
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
  expect(readFreeAccessCommand('a', 'o')).toBeNull()
})
it('после сетевой ошибки сохраняет команду и повторяет тот же id', async () => {
  const command = await prepareFreeAccessCommand('a', 'o', 1, 'trial', { target: 'p', browserHash: 'a'.repeat(64) })
  mocks.rpc.mockResolvedValueOnce({ data: { organization_id: 'o', found: false } }).mockResolvedValueOnce({ error: { message: 'network' } })
  await expect(sendFreeAccessCommand('a', 'o')).rejects.toEqual({ message: 'network' })
  expect(readFreeAccessCommand('a', 'o').id).toBe(command.id)
  mocks.rpc.mockResolvedValueOnce({ data: { organization_id: 'o', found: false } }).mockResolvedValueOnce({ data: receipt })
  await sendFreeAccessCommand('a', 'o')
  expect(mocks.rpc.mock.calls[3][1].p_command_id).toBe(command.id)
})
it('чужой receipt не снимает pending и другой аккаунт его не видит', async () => {
  await prepareFreeAccessCommand('a', 'o', 1, 'trial', { target: 'p', browserHash: 'a'.repeat(64) })
  expect(readFreeAccessCommand('b', 'o')).toBeNull()
  mocks.rpc.mockResolvedValue({ data: { organization_id: 'o', found: true, receipt: { ...receipt, organization_id: 'other' } } })
  await expect(sendFreeAccessCommand('a', 'o')).rejects.toThrow('не подтверждён')
  expect(readFreeAccessCommand('a', 'o')).not.toBeNull()
})
it('старый сохранённый промозапрос не отправляется и не удаляется', async () => {
  const old = JSON.stringify({ org: 'o', kind: 'promotion', id: 'old' })
  sessionStorage.setItem('free-access-command:a:o', old)
  await expect(sendFreeAccessCommand('a', 'o')).rejects.toThrow('отключена')
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('free-access-command:a:o')).toBe(old)
})
it('определённый отказ очищает команду, позволяя новое подтверждение', async () => {
  await prepareFreeAccessCommand('a', 'o', 1, 'trial', { target: 'p', browserHash: 'a'.repeat(64) })
  mocks.rpc.mockResolvedValueOnce({ data: { organization_id: 'o', found: false } }).mockResolvedValueOnce({ data: { ok: false, reason: 'revision_conflict' } })
  await expect(sendFreeAccessCommand('a', 'o', 'code')).rejects.toThrow('изменилась')
  expect(readFreeAccessCommand('a', 'o')).toBeNull()
})
it('новую команду старого промодоступа нельзя подготовить', async () => {
  await expect(prepareFreeAccessCommand('a', 'o', 1, 'promotion', {})).rejects.toThrow('больше не поддерживается')
  expect(sessionStorage.getItem('free-access-command:a:o')).toBeNull()
  expect(mocks.rpc).not.toHaveBeenCalled()
})
