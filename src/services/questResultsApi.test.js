import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { canClearQuestResults, searchQuestResults } from './questResultsApi'
beforeEach(() => rpc.mockReset())
it('не принимает страницу с другим порядком', async () => {
  rpc.mockResolvedValue({ data: { quest_id: 'q1', completion: 'all', sort: 'newest', items: [], has_more: false } })
  await expect(searchQuestResults('q1', { sort: 'name' })).rejects.toThrow('Некорректный ответ')
})
it('проверяет серверное право удаления именно этого квеста', async () => {
  rpc.mockResolvedValue({ data: true })
  await expect(canClearQuestResults('q1')).resolves.toBe(true)
  expect(rpc).toHaveBeenCalledWith('has_quest_permission', { target_quest_id: 'q1', required_permission: 'quest_stats.delete' })
  rpc.mockResolvedValue({ data: 'true' })
  await expect(canClearQuestResults('q1')).resolves.toBe(false)
})
it('передаёт поиск, фильтр, курсор и отмену', async () => {
  const data = { quest_id: 'q1', completion: 'finished', sort: 'newest', items: [], has_more: false }
  const abortSignal = vi.fn().mockResolvedValue({ data })
  rpc.mockReturnValue({ abortSignal })
  const signal = new AbortController().signal
  await expect(searchQuestResults('q1', { search: ' Саша ', completion: 'finished', cursor: { id: 'a1' } }, signal)).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_quest_results_sorted', { p_quest_id: 'q1', p_search: 'Саша', p_completion: 'finished', p_after: { id: 'a1' }, p_limit: 25, p_sort: 'newest' })
  expect(abortSignal).toHaveBeenCalledWith(signal)
})
it.each([
  { quest_id: 'q2', completion: 'all', items: [], has_more: false },
  { quest_id: 'q1', completion: 'finished', sort: 'newest', items: [], has_more: false },
  { quest_id: 'q1', completion: 'all', items: [], has_more: true },
])('не принимает несогласованный ответ %#', async data => {
  rpc.mockResolvedValue({ data })
  await expect(searchQuestResults('q1')).rejects.toThrow('Некорректный ответ')
})
it('сохраняет серверный отказ для очистки списка интерфейсом', async () => {
  const error = { code: '42501' }
  rpc.mockResolvedValue({ error })
  await expect(searchQuestResults('q1')).rejects.toEqual(error)
})
