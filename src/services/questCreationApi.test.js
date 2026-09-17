import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { createOrganizationQuest } from './questCreationApi'
const result = '00000000-0000-4000-8000-000000000001'
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear(); rpc.mockReset(); rpc.mockResolvedValue({ data: result, error: null }) })
afterEach(() => vi.unstubAllGlobals())
it('потерянный ответ сохраняет ключ после повторного импорта модуля', async () => {
  rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(createOrganizationQuest('u','o',{ title: 'A' })).rejects.toThrow()
  const key = rpc.mock.calls[0][1].p_operation_id
  vi.resetModules()
  const api = await import('./questCreationApi')
  expect(await api.createOrganizationQuest('u','o',{ title: 'A' })).toBe(result)
  expect(rpc.mock.calls[1][1].p_operation_id).toBe(key)
  expect(sessionStorage.length).toBe(0)
  await api.createOrganizationQuest('u','o',{ title: 'A' })
  expect(rpc.mock.calls[2][1].p_operation_id).not.toBe(key)
})
it('ключи изолированы по аккаунту, организации, источнику и параметрам', async () => {
  rpc.mockResolvedValue({ error: { code: 'test' } })
  for (const args of [['u','o',{ title:'A' }],['v','o',{title:'A'}],['u','p',{title:'A'}],['u','o',{},'source'],['u','o',{title:'B'}]]) {
    await expect(createOrganizationQuest(...args)).rejects.toBeDefined()
  }
  expect(new Set(rpc.mock.calls.map(call => call[1].p_operation_id)).size).toBe(5)
})
it('порядок полей не меняет ключ; неверный ответ его не удаляет', async () => {
  rpc.mockResolvedValue({ data: {}, error: null })
  await expect(createOrganizationQuest('u','o',{ title:'A', is_public:false })).rejects.toThrow()
  await expect(createOrganizationQuest('u','o',{ is_public:false, title:'A' })).rejects.toThrow()
  expect(rpc.mock.calls[0][1].p_operation_id).toBe(rpc.mock.calls[1][1].p_operation_id)
})
it('отказ сохранения ключа не отправляет запрос', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('storage unavailable') } })
  await expect(createOrganizationQuest('u','o',{title:'A'})).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
