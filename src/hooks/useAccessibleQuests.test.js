import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), offline: vi.fn() }))
vi.mock('../services/questApi', () => ({ listAccessiblePrivateQuests: mocks.list }))
vi.mock('../services/db', () => ({ getOfflineAccessiblePrivateQuests: mocks.offline }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))
import { useAccessibleQuests } from './useAccessibleQuests'

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())
it('отбрасывает поздний ответ запроса после обновления', async () => {
  let resolveFirst
  let firstSignal
  mocks.list.mockImplementationOnce(signal => { firstSignal = signal; return new Promise(resolve => { resolveFirst = resolve }) })
  mocks.list.mockResolvedValueOnce([{ quest_id: 'fresh' }])
  const { result } = renderHook(() => useAccessibleQuests('user-a'))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))
  act(() => window.dispatchEvent(new Event('online')))
  await waitFor(() => expect(result.current.accessibleQuests).toEqual([{ quest_id: 'fresh' }]))
  expect(firstSignal.aborted).toBe(true)
  await act(async () => resolveFirst([{ quest_id: 'stale' }]))
  expect(result.current.accessibleQuests).toEqual([{ quest_id: 'fresh' }])
})
it('в offline запрашивает только разрешённую локальную копию аккаунта', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  mocks.offline.mockResolvedValue([{ quest_id: 'local' }])
  const { result } = renderHook(() => useAccessibleQuests('user-a'))
  await waitFor(() => expect(result.current.accessibleQuestsLoading).toBe(false))
  expect(mocks.offline).toHaveBeenCalledWith('user-a')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(result.current.usingOfflineAccessibleQuests).toBe(true)
})
