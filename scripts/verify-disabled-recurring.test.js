import { expect, test, vi } from 'vitest'
import { verifyDisabledRecurring } from './verify-disabled-recurring.mjs'
const config = { projectId: 'jeugfyaqzfgdvfhdxfht', token: 'a'.repeat(64) }
test('checks disabled endpoint, sending token only for final request', async () => {
  const statuses = [405, 401, 503]
  const fetchImpl = vi.fn(async () => new Response(null, { status: statuses.shift(), headers: { 'Cache-Control': 'no-store' } }))
  await verifyDisabledRecurring({ ...config, fetchImpl })
  expect(fetchImpl).toHaveBeenCalledTimes(3)
  expect(fetchImpl.mock.calls[0][1].headers).toEqual({})
  expect(fetchImpl.mock.calls[1][1].headers).toEqual({})
  expect(fetchImpl.mock.calls[2][1].headers).toEqual({ 'x-qvesta-worker-token': config.token })
  expect(fetchImpl.mock.calls[2][1].redirect).toBe('error')
})
test('rejects other targets before network access', async () => {
  const fetchImpl = vi.fn()
  await expect(verifyDisabledRecurring({ ...config, projectId: 'production', fetchImpl })).rejects.toThrow()
  expect(fetchImpl).not.toHaveBeenCalled()
})
test('rejects unexpected response without including its contents', async () => {
  const fetchImpl = vi.fn(async () => new Response('private details', { status: 200 }))
  await expect(verifyDisabledRecurring({ ...config, fetchImpl })).rejects.toThrow('Disabled recurring smoke failed')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
