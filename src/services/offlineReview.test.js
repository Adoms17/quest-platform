import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), mark: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('./db', () => ({ markResultsForReview: mocks.mark }))
import { preserveOfflineReview } from './offlineReview'
const records = [{ id: 1, clientEventId: 'event', taskId: 'task', eventType: 'answer', submittedValue: 'answer' }]
beforeEach(() => vi.resetAllMocks())
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
