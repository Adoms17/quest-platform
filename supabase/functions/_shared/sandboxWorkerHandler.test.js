// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createSandboxWorkerHandler } from './sandboxWorkerHandler.js'
const token = 'ab'.repeat(32)
const request = (headers = {}, method = 'POST') => new Request('https://example.test/worker', { method, headers })
it.each([undefined, '', 'ab', 'g'.repeat(64)])('некорректная конфигурация закрывает worker: %s', async configured => {
  const run = vi.fn()
  const response = await createSandboxWorkerHandler({ token: configured, enabled: true, run })(request({ 'x-qvesta-worker-token': token }))
  expect(response.status).toBe(401)
  expect(run).not.toHaveBeenCalled()
})
it.each([{}, { Authorization: `Bearer ${token}` }, { apikey: token }, { 'x-qvesta-worker-token': 'cd'.repeat(32) }, { 'x-qvesta-worker-token': `${token}, ${token}` }])('не принимает отсутствующий/неверный токен или другие заголовки: %j', async headers => {
  const run = vi.fn()
  expect((await createSandboxWorkerHandler({ token, enabled: true, run })(request(headers))).status).toBe(401)
  expect(run).not.toHaveBeenCalled()
})
it('не запускает выключенный sandbox даже с правильным токеном', async () => {
  const run = vi.fn()
  expect((await createSandboxWorkerHandler({ token, run })(request({ 'x-qvesta-worker-token': token }))).status).toBe(503)
  expect(run).not.toHaveBeenCalled()
})
it('разрешает POST с выделенным токеном и возвращает результат без кэширования', async () => {
  const run = vi.fn().mockResolvedValue({ checked: 0, failed: 0 })
  const response = await createSandboxWorkerHandler({ token, enabled: true, run })(request({ 'x-qvesta-worker-token': token }))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ checked: 0, failed: 0 })
  expect(run).toHaveBeenCalledTimes(1)
})
it('ротация отвергает прежний токен', async () => {
  const run = vi.fn()
  expect((await createSandboxWorkerHandler({ token: 'cd'.repeat(32), enabled: true, run })(request({ 'x-qvesta-worker-token': token }))).status).toBe(401)
  expect(run).not.toHaveBeenCalled()
})
it('не раскрывает внутренние ошибки', async () => {
  const response = await createSandboxWorkerHandler({ token, enabled: true, run: async () => { throw Error('private detail') } })(request({ 'x-qvesta-worker-token': token }))
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('')
})
it.each(['GET', 'OPTIONS'])('не запускает worker методом %s', async method => {
  const run = vi.fn()
  expect((await createSandboxWorkerHandler({ token, enabled: true, run })(request({ 'x-qvesta-worker-token': token }, method))).status).toBe(405)
  expect(run).not.toHaveBeenCalled()
})
