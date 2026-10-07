import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock('../services/accountActivity', () => ({ startAccountActivity: mocks.start }))
import { useAccountActivity } from './useAccountActivity'
beforeEach(() => { vi.clearAllMocks(); mocks.start.mockReturnValue(mocks.stop) })

it('starts for restored/sign-in identity, not token or same-account rerenders', () => {
  const { rerender, unmount } = renderHook(({ session }) => useAccountActivity(session?.user?.id), { initialProps: { session: null } })
  expect(mocks.start).not.toHaveBeenCalled()
  rerender({ session: { user: { id: 'A' }, access_token: 'synthetic-1' } })
  rerender({ session: { user: { id: 'A' }, access_token: 'synthetic-2' } })
  expect(mocks.start).toHaveBeenCalledTimes(1)
  unmount(); expect(mocks.stop).toHaveBeenCalledTimes(1)
})
it('cleans up on account switch and logout', () => {
  const { rerender } = renderHook(id => useAccountActivity(id), { initialProps: 'A' })
  rerender('B'); expect(mocks.stop).toHaveBeenCalledTimes(1); expect(mocks.start).toHaveBeenCalledTimes(2)
  rerender(null); expect(mocks.stop).toHaveBeenCalledTimes(2)
})
