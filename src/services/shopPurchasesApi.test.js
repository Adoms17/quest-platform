import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { listShopPurchases, issueShopCopy, SHOP_PURCHASE_TIMEOUT_MS } from './shopPurchasesApi'
const org = '00000000-0000-4000-8000-000000000001'
const acquisition = '00000000-0000-4000-8000-000000000002'
const copy = '00000000-0000-4000-8000-000000000003'
beforeEach(() => { rpc.mockReset() })
afterEach(() => { vi.useRealTimers() })

it.each(['list', 'issue'])('bounds a never-settling %s transport and cleans up listeners', async operation => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  rpc.mockReturnValue(new Promise(() => {}))
  const pending = operation === 'list' ? listShopPurchases(org, controller.signal) : issueShopCopy(org, acquisition, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ code: operation === 'list' ? 'SHOP_PURCHASE_TIMEOUT' : 'SHOP_COPY_OUTCOME_UNKNOWN' })
  await vi.advanceTimersByTimeAsync(SHOP_PURCHASE_TIMEOUT_MS)
  await rejected
  expect(vi.getTimerCount()).toBe(0)
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(rpc).toHaveBeenCalledTimes(1)
})

it.each(['list', 'issue'])('stops a %s wait on unmount even if transport ignores cancellation', async operation => {
  vi.useFakeTimers()
  const controller = new AbortController()
  rpc.mockReturnValue(new Promise(() => {}))
  const pending = operation === 'list' ? listShopPurchases(org, controller.signal) : issueShopCopy(org, acquisition, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
  expect(vi.getTimerCount()).toBe(0)
})

it('does not send an already canceled request and clears a successful wait', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  controller.abort()
  await expect(issueShopCopy(org, acquisition, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(listShopPurchases(org, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(rpc).not.toHaveBeenCalled()
  rpc.mockResolvedValue({ data: copy })
  expect(await issueShopCopy(org, acquisition)).toBe(copy)
  expect(vi.getTimerCount()).toBe(0)
})
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
