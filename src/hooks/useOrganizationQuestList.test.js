import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../services/organizationQuestApi', () => ({ searchOrganizationQuests: mocks.search }))
import { useOrganizationQuestList } from './useOrganizationQuestList'
let actor = 0
const page = (ids, more = false) => ({ items: ids.map(id => ({ id, title: id, is_open: true })), has_more: more, next_cursor: more ? { id: ids.at(-1) } : null })
function props() { return { userId: `actor-${++actor}`, organizationId: 'org-a', enabled: true } }
beforeEach(() => {
  mocks.search.mockReset()
  mocks.search.mockResolvedValue(page([]))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
it('не запрашивает рабочие записи без permission', async () => {
  renderHook(() => useOrganizationQuestList({ ...props(), enabled: false }))
  await act(async () => {})
  expect(mocks.search).not.toHaveBeenCalled()
})
it('передаёт фильтры, курсор и устраняет повтор при догрузке', async () => {
  mocks.search.mockResolvedValueOnce(page(['a', 'b'], true)).mockResolvedValueOnce(page(['b', 'c']))
  const { result } = renderHook(() => useOrganizationQuestList(propsForTest), { initialProps: undefined })
  await waitFor(() => expect(result.current.items).toHaveLength(2))
  await act(async () => result.current.loadMore())
  expect(result.current.items.map(x => x.id)).toEqual(['a','b','c'])
  expect(mocks.search.mock.calls[1][0].cursor).toEqual({ id: 'b' })
})
const propsForTest = { userId: 'append-actor', organizationId: 'org-a', enabled: true }
it('не теряет первую порцию при ошибке следующей и допускает retry', async () => {
  mocks.search.mockResolvedValueOnce(page(['a'], true)).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(page(['b']))
  const input = props()
  const { result } = renderHook(() => useOrganizationQuestList(input))
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  await act(async () => result.current.loadMore())
  expect(result.current.items.map(x=>x.id)).toEqual(['a'])
  expect(result.current.error).toBeTruthy()
  await act(async () => result.current.loadMore())
  expect(result.current.items.map(x=>x.id)).toEqual(['a','b'])
})
it('очищает данные после отказа сервера при догрузке', async () => {
  mocks.search.mockResolvedValueOnce(page(['a'], true)).mockRejectedValueOnce({ code: '42501' })
  const input = props()
  const { result } = renderHook(() => useOrganizationQuestList(input))
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  await act(async () => result.current.loadMore())
  expect(result.current.items).toEqual([])
})
it('отменяет устаревшую догрузку при смене поиска', async () => {
  let resolveOld
  mocks.search.mockResolvedValueOnce(page(['a'], true)).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(page(['fresh']))
  const input = props()
  const { result } = renderHook(() => useOrganizationQuestList(input))
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  act(() => { void result.current.loadMore() })
  const previousSignal = mocks.search.mock.calls[1][0].signal
  act(() => result.current.setSearch('маяк'))
  expect(result.current.items).toEqual([])
  expect(previousSignal.aborted).toBe(true)
  await waitFor(() => expect(result.current.items[0]?.id).toBe('fresh'))
  await act(async () => resolveOld(page(['stale'])))
  expect(result.current.items.map(x=>x.id)).toEqual(['fresh'])
})
it('после возврата восстанавливает фильтр и заново проверяет страницы сервером', async () => {
  const input = props()
  mocks.search.mockResolvedValueOnce(page(['a'], true)).mockResolvedValueOnce(page(['x'], true)).mockResolvedValueOnce(page(['y']))
  const first = renderHook(() => useOrganizationQuestList(input))
  await waitFor(() => expect(first.result.current.items).toHaveLength(1))
  act(() => first.result.current.setSearch('маршрут'))
  await waitFor(() => expect(first.result.current.items[0]?.id).toBe('x'))
  await act(async () => first.result.current.loadMore())
  first.unmount()
  mocks.search.mockResolvedValueOnce(page(['x'], true)).mockResolvedValueOnce(page(['y']))
  const second = renderHook(() => useOrganizationQuestList(input))
  expect(second.result.current.search).toBe('маршрут')
  expect(second.result.current.items).toEqual([])
  await waitFor(() => expect(second.result.current.items.map(x=>x.id)).toEqual(['x','y']))
  expect(mocks.search.mock.calls[3][0].cursor).toBeNull()
  expect(mocks.search.mock.calls[4][0].cursor).toEqual({ id:'x' })
})
