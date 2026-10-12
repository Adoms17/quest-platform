import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { listShopPurchases, issueShopCopy } from './shopPurchasesApi'
const org = '00000000-0000-4000-8000-000000000001'
const acquisition = '00000000-0000-4000-8000-000000000002'
const copy = '00000000-0000-4000-8000-000000000003'
beforeEach(() => rpc.mockReset())
it('never treats a malformed or wrong-organization library as empty', async () => {
  for (const data of [null, {}, [{ acquisition_id: acquisition, organization_id: copy }]]) {
    rpc.mockResolvedValue({ data })
    await expect(listShopPurchases(org)).rejects.toThrow()
  }
  rpc.mockResolvedValue({ data: [] })
  expect(await listShopPurchases(org)).toEqual([])
})
it('propagates backend errors', async () => {
  const error = { code: '42501' }
  rpc.mockResolvedValue({ error })
  await expect(listShopPurchases(org)).rejects.toBe(error)
  await expect(issueShopCopy(org, acquisition)).rejects.toBe(error)
})
it('retry after response loss sends the same acquisition and exact target', async () => {
  rpc.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ data: copy })
  await expect(issueShopCopy(org, acquisition)).rejects.toThrow()
  expect(await issueShopCopy(org, acquisition)).toBe(copy)
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  expect(rpc.mock.calls[1]).toEqual(['issue_shop_quest_copy', { p_organization_id: org, p_acquisition_id: acquisition }])
})
it('rejects invalid input and invalid copy identifiers', async () => {
  await expect(issueShopCopy('wrong', acquisition)).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
  rpc.mockResolvedValue({ data: { id: copy } })
  await expect(issueShopCopy(org, acquisition)).rejects.toThrow()
})
