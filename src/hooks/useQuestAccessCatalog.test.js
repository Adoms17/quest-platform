import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../services/questAccessApi', () => ({ searchQuestAccess: mocks.search }))
import { useQuestAccessCatalog } from './useQuestAccessCatalog'
const page = (items, more = false) => ({ items, has_more: more, next_cursor: more ? { id: items.at(-1).id } : null })
beforeEach(() => vi.resetAllMocks())
it('не запрашивает сервер без аккаунта', () => {
  const { result } = renderHook(() => useQuestAccessCatalog(null, 'q1', 'credentials', '', 0))
  expect(result.current.items).toEqual([]); expect(mocks.search).not.toHaveBeenCalled()
})
it('передаёт курсор, сохраняет строки при ошибке и устраняет дубликаты после retry', async () => {
  mocks.search.mockResolvedValueOnce(page([{ id: 'q1' }], true)).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(page([{ id: 'q1' }, { id: 'q2' }]))
  const { result } = renderHook(() => useQuestAccessCatalog('a1', 'q1', 'credentials', '', 0))
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  await act(() => result.current.loadMore())
  expect(result.current.error).toBe(true); expect(result.current.items).toHaveLength(1)
  await act(() => result.current.loadMore())
  expect(result.current.items).toEqual([{ id: 'q1' }, { id: 'q2' }])
  expect(mocks.search.mock.calls[1][2].cursor).toEqual({ id: 'q1' })
})
it('при смене профиля немедленно убирает строки и игнорирует поздний ответ', async () => {
  let finish
  mocks.search.mockResolvedValueOnce(page([{ id: 'old' }], true)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page([{ id: 'new' }]))
  const { result, rerender } = renderHook(({ profile }) => useQuestAccessCatalog('a1', profile, 'credentials', '', 0), { initialProps: { profile: 'p1' } })
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  act(() => { void result.current.loadMore() })
  rerender({ profile: 'p2' }); expect(result.current.items).toEqual([])
  await waitFor(() => expect(result.current.items).toEqual([{ id: 'new' }]))
  await act(async () => finish(page([{ id: 'leak' }])))
  expect(result.current.items).toEqual([{ id: 'new' }])
})
it('отказ в доступе при догрузке очищает выдачу', async () => {
  mocks.search.mockResolvedValueOnce(page([{ id: 'q1' }], true)).mockRejectedValueOnce({ code: '42501' })
  const { result } = renderHook(() => useQuestAccessCatalog('a1', 'q1', 'credentials', '', 0))
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  await act(() => result.current.loadMore())
  expect(result.current.items).toEqual([]); expect(result.current.denied).toBe(true)
})

