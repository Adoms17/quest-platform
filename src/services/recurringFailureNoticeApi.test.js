import { beforeEach, expect, test, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { readRecurringFailureNotice } from './recurringFailureNoticeApi'
beforeEach(() => vi.resetAllMocks())
test('returns only status and dates, or null when resolved', async () => {
 rpc.mockResolvedValueOnce({data:{status:'payment_failed',period_start:'2026-09-23T00:00:00Z',failed_at:'2026-09-23T01:00:00Z',payment_id:'private'}}).mockResolvedValueOnce({data:null})
 expect(await readRecurringFailureNotice('org')).toEqual({status:'payment_failed',periodStart:'2026-09-23T00:00:00Z',failedAt:'2026-09-23T01:00:00Z'})
 expect(await readRecurringFailureNotice('org')).toBeNull()
})
test('rejects unknown status and hides server error', async () => {
 rpc.mockResolvedValueOnce({data:{status:'pending'}}).mockResolvedValueOnce({error:{message:'private'}})
 await expect(readRecurringFailureNotice('org')).rejects.toThrow('Не удалось проверить автопродление.')
 await expect(readRecurringFailureNotice('org')).rejects.toThrow('Не удалось проверить автопродление.')
})
