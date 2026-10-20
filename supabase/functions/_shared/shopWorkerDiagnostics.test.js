// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createSandboxWorkerHandler } from './sandboxWorkerHandler.js'
import { createSandboxOrderWorkerHandler } from './sandboxOrderWorkerHandler.js'

const token = 'ab'.repeat(32)
const request = () => new Request('https://example.test/worker', {
  method: 'POST', headers: { 'x-qvesta-worker-token': token },
})
afterEach(() => vi.restoreAllMocks())

it.each([createSandboxWorkerHandler, createSandboxOrderWorkerHandler])('existing callers stay silent with unchanged OFF response', async factory => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const run = vi.fn()
  const response = await factory({ token, run })(request())
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.text()).toBe('')
  expect(run).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
})

it.each([false, true])('opt-in OFF diagnostics tolerate logger failure: %s', async throws => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => { if (throws) throw Error('logger unavailable') })
  const run = vi.fn()
  const response = await createSandboxWorkerHandler({ token, run, diagnostics: true })(request())
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('')
  expect(run).not.toHaveBeenCalled()
  expect(log.mock.calls).toEqual([['SHOP_WORKER_AUTHENTICATED_OFF_V1']])
})

it.each([undefined, false, true])('run failure preserves response and emits only the opted-in fixed event: %s', async diagnostics => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const run = vi.fn().mockRejectedValue(Error('private detail'))
  const response = await createSandboxWorkerHandler({ token, enabled: true, run, diagnostics })(request())
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('')
  expect(run).toHaveBeenCalledTimes(1)
  expect(log.mock.calls).toEqual(diagnostics === true ? [['SHOP_WORKER_RUN_FAILED_V1']] : [])
})

it('successful opt-in call preserves payload without diagnostics', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const response = await createSandboxWorkerHandler({ token, enabled: true, diagnostics: true, run: async () => ({ checked: 0 }) })(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ checked: 0 })
  expect(log).not.toHaveBeenCalled()
})
