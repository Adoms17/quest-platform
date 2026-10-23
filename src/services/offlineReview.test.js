import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), mark: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('./db', () => ({ markResultsForReview: mocks.mark }))
import { preserveOfflineReview } from './offlineReview'
const records = [{ id: 1, clientEventId: 'event', taskId: 'task', eventType: 'answer', submittedValue: 'answer' }]
beforeEach(() => vi.resetAllMocks())

test('конфликт permit передаётся отдельному RPC и подтверждается до изменения очереди', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { state: 'needs_review', receipts: [] } })
    .mockResolvedValueOnce({ data: { state: 'needs_review', receipts: [{ id: 'receipt', client_event_id: 'event', state: 'needs_review' }] } })
  await expect(preserveOfflineReview('quest','profile','local','actor',records,'needs_review','permit')).rejects.toThrow('не подтвердил')
  expect(mocks.mark).not.toHaveBeenCalled()
  await preserveOfflineReview('quest','profile','local','actor',records,'needs_review','permit')
  expect(mocks.rpc).toHaveBeenLastCalledWith('preserve_conflicting_offline_events', expect.objectContaining({ p_permit_id: 'permit' }))
  expect(mocks.mark).toHaveBeenCalledTimes(1)
})
test('частичный receipt не меняет локальную очередь', async () => {
  mocks.rpc.mockResolvedValue({ data: { state: 'needs_review', receipts: [] } })
  await expect(preserveOfflineReview('quest','profile','local','actor',records)).rejects.toThrow('не подтвердил')
  expect(mocks.mark).not.toHaveBeenCalled()
})
test('доставка помечается для проверки только после полного receipt', async () => {
  const receipts = [{ id: 'receipt', client_event_id: 'event', state: 'needs_review' }]
  mocks.rpc.mockResolvedValue({ data: { state: 'needs_review', receipts } })
  await preserveOfflineReview('quest','profile','local','actor',records)
  expect(mocks.mark).toHaveBeenCalledWith('actor',records,receipts)
})
test('отказ по лимиту требует полного серверного подтверждения и не помечается как ожидающий проверки', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { state: 'invalid_limit', receipts: [] } })
    .mockResolvedValueOnce({ data: { state: 'invalid_limit', receipts: [{ id: 'receipt', client_event_id: 'event', state: 'invalid_limit' }] } })
  await expect(preserveOfflineReview('quest','profile','local','actor',records,'invalid_limit')).rejects.toThrow()
  await preserveOfflineReview('quest','profile','local','actor',records,'invalid_limit')
  expect(mocks.rpc.mock.calls[1][0]).toBe('preserve_limit_rejected_offline_events')
  expect(mocks.mark).not.toHaveBeenCalled()
})
