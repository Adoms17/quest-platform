import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { searchOrganizationAudit } from './teamCatalogApi'
beforeEach(() => { rpc.mockReset() })
it('передаёт строковый курсор и отмену без потери bigint', async () => {
  const data = { organization_id: 'o1', category: 'team', items: [], has_more: false }
  const abortSignal = vi.fn().mockResolvedValue({ data })
  rpc.mockReturnValue({ abortSignal })
  const signal = new AbortController().signal, cursor = { id: '9007199254741061' }
  await expect(searchOrganizationAudit('o1', { category: 'team', cursor }, signal)).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_organization_audit', { p_organization_id: 'o1', p_category: 'team', p_after: cursor, p_limit: 25 })
  expect(abortSignal).toHaveBeenCalledWith(signal)
})
it.each([{ organization_id: 'o2' }, { category: 'team' }, { has_more: true }])('отклоняет несогласованный ответ %#', overrides => {
  rpc.mockResolvedValue({ data: { organization_id: 'o1', category: 'all', items: [], has_more: false, ...overrides } })
  return expect(searchOrganizationAudit('o1')).rejects.toThrow('Некорректный ответ')
})
it('сохраняет серверный отказ', async () => {
  const error = { code: '42501' }; rpc.mockResolvedValue({ error })
  await expect(searchOrganizationAudit('o1')).rejects.toEqual(error)
})
