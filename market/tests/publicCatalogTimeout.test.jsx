import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import PublicMarket from '../src/PublicMarket'
import { createPublicCatalogAdapter } from '../src/publicCatalog'

afterEach(() => vi.useRealTimers())

function transport() {
  const requests = []
  const fetcher = vi.fn((_url, options) => new Promise((resolve, reject) => {
    requests.push({ signal: options.signal, resolve })
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const adapter = createPublicCatalogAdapter({ url: 'https://catalog.invalid', key: 'synthetic-only', fetcher, timeout: 100 })
  return { adapter, requests, fetcher }
}

it('turns an actual adapter timeout into a recoverable UI error and retries once', async () => {
  vi.useFakeTimers()
  const { adapter, requests, fetcher } = transport()
  render(<MemoryRouter><PublicMarket adapter={adapter} /></MemoryRouter>)
  await act(async () => {})
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alert')).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(requests[0].signal.aborted).toBe(true)
  const alert = screen.getByRole('alert')
  expect(screen.queryAllByRole('article')).toHaveLength(0)
  // No automatic retry after a timeout; the visitor controls recovery.
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.click(alert.querySelector('button'))
  await act(async () => {})
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
  await act(async () => requests[1].resolve({ ok: true, json: async () => [] }))
  expect(screen.getByRole('status')).toHaveTextContent('0')
  expect(screen.queryByRole('alert')).toBeNull()
  // Shared page-position restoration schedules one animation frame after load.
  await act(async () => vi.advanceTimersByTimeAsync(32))
  expect(vi.getTimerCount()).toBe(0)
})

it('aborts the actual fetch and clears its timer when leaving a loading route', async () => {
  vi.useFakeTimers()
  const { adapter, requests, fetcher } = transport()
  render(<MemoryRouter initialEntries={['/quests/pending']}><PublicMarket adapter={adapter} /></MemoryRouter>)
  await act(async () => {})
  expect(fetcher).toHaveBeenCalledTimes(1)
  // Header catalogue link leaves the detail route while its request is pending.
  fireEvent.click(document.querySelector('header nav a[href="/"]'))
  await act(async () => {})
  expect(requests[0].signal.aborted).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(1)
  await act(async () => requests[1].resolve({ ok: true, json: async () => [] }))
  await act(async () => vi.advanceTimersByTimeAsync(32))
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('0')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('distinguishes caller cancellation from timeout and clears the request timer', async () => {
  vi.useFakeTimers()
  const { adapter, requests } = transport()
  const caller = new AbortController()
  const result = adapter.list({ signal: caller.signal })
  const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  caller.abort()
  await rejection
  expect(requests[0].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
