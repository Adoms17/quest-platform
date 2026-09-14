import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { searchOrganizationTeam } from './teamCatalogApi'
beforeEach(() => { rpc.mockReset() })
it('передаёт организацию, поиск, фильтр, курсор и отмену', async () => {
  const data = { organization_id: 'o1', kind: 'members', status: 'active', items: [], has_more: false }
  const abortSignal = vi.fn().mockResolvedValue({ data })
  rpc.mockReturnValue({ abortSignal })
  const signal = new AbortController().signal
  await expect(searchOrganizationTeam('o1', 'members', { search: ' Саша ', status: 'active', cursor: { id: 'm1' } }, signal)).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_organization_team_catalog', { p_organization_id: 'o1', p_kind: 'members', p_search: 'Саша', p_status: 'active', p_after: { id: 'm1' }, p_limit: 25 })
  expect(abortSignal).toHaveBeenCalledWith(signal)
})
it.each([{ organization_id: 'o2' }, { kind: 'invitations' }, { status: 'active' }, { has_more: true }])('отклоняет несогласованную страницу %#', async overrides => {
  rpc.mockResolvedValue({ data: { organization_id: 'o1', kind: 'members', status: 'all', items: [], has_more: false, ...overrides } })
  await expect(searchOrganizationTeam('o1', 'members')).rejects.toThrow('Некорректный ответ')
})
it('передаёт отказ сервера вызывающему коду', async () => {
  const error = { code: '42501' }
  rpc.mockResolvedValue({ error })
  await expect(searchOrganizationTeam('o1', 'members')).rejects.toEqual(error)
})
