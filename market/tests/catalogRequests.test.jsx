import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCatalog } from '../src/useCatalog'

function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

it('ignores a late response from an adapter that ignores AbortSignal', async () => {
  const old = deferred(); const fresh = deferred()
  const first = { list: vi.fn(() => old.promise) }; const second = { list: vi.fn(() => fresh.promise) }
  const { result, rerender } = renderHook(({ adapter }) => useCatalog(adapter), { initialProps: { adapter: first } })
  await waitFor(() => expect(first.list).toHaveBeenCalledTimes(1))
  rerender({ adapter: second })
  expect(first.list.mock.calls[0][0].signal.aborted).toBe(true)
  await act(async () => fresh.resolve([{ slug: 'fresh' }]))
  await act(async () => old.resolve([{ slug: 'stale' }]))
  expect(result.current.items).toEqual([{ slug: 'fresh' }])
})

it('aborts immediately on rapid retries and rejects obsolete errors', async () => {
  const requests = []
  const adapter = { list: vi.fn(({ signal }) => { const next = deferred(); requests.push({ ...next, signal }); return next.promise }) }
  const { result, unmount } = renderHook(() => useCatalog(adapter))
  await waitFor(() => expect(requests).toHaveLength(1))
  act(() => { result.current.retry(); expect(requests[0].signal.aborted).toBe(true); result.current.retry() })
  await waitFor(() => expect(requests).toHaveLength(2))
  await act(async () => requests[1].resolve([{ slug: 'latest' }]))
  await act(async () => requests[0].reject(new Error('obsolete network failure')))
  expect(result.current.status).toBe('ready')
  expect(result.current.items).toEqual([{ slug: 'latest' }])
  unmount()
  expect(requests[1].signal.aborted).toBe(true)
})

it('presents synchronous source failure as error and retries', async () => {
  const adapter = { list: vi.fn().mockImplementationOnce(() => { throw new Error('offline') }).mockResolvedValue([]) }
  const { result } = renderHook(() => useCatalog(adapter))
  await waitFor(() => expect(result.current.status).toBe('error'))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.items).toEqual([])
})

it('does not reuse ready A during A to pending B to pending A replacement', async () => {
  const pendingA = deferred(); const pendingB = deferred()
  const adapterA = { list: vi.fn().mockResolvedValueOnce([{ slug: 'old-a' }]).mockReturnValue(pendingA.promise) }
  const adapterB = { list: vi.fn(() => pendingB.promise) }
  const { result, rerender } = renderHook(({ adapter }) => useCatalog(adapter), { initialProps: { adapter: adapterA } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  rerender({ adapter: adapterB })
  rerender({ adapter: adapterA })
  expect(result.current.status).toBe('loading')
  expect(result.current.items).toEqual([])
  await act(async () => pendingA.resolve([{ slug: 'new-a' }]))
  await act(async () => pendingB.resolve([{ slug: 'obsolete-b' }]))
  expect(result.current.items).toEqual([{ slug: 'new-a' }])
})
