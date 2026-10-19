import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createDiagnosticClient, createDiagnosticFetch, createDiagnosticRun, createDiagnosticScope,
  diagnosticAllowed, safeResult, ORDER_ID, STAGE_BACKEND, STAGE_ORIGIN, DIAGNOSTIC_PATH, DEADLINE_MS } from './shopOffDiagnostic'

const allowed = { mode: 'staging', flag: 'true', backend: STAGE_BACKEND, origin: STAGE_ORIGIN, pathname: DIAGNOSTIC_PATH }
const environment = () => allowed
const endpoint = STAGE_BACKEND + '/functions/v1/shop-checkout'
const body = JSON.stringify({ orderId: ORDER_ID, action: 'availability' })
const init = () => ({ method: 'POST', body, signal: new AbortController().signal })
const response = (payload, status = 503, headers = {}) => new Response(JSON.stringify(payload), {
  status, headers: { 'content-type': 'application/json', ...headers },
})
const off = () => response({ error: 'configuration_unavailable' })
function harness(fetcher) {
  const guarded = createDiagnosticFetch(fetcher, environment)
  const invoke = vi.fn(async (name, options) => ({
    data: await (await guarded(STAGE_BACKEND + '/functions/v1/' + name, { ...options, body: JSON.stringify(options.body) })).json(),
  }))
  const onResult = vi.fn(), runner = createDiagnosticRun(), controller = new AbortController()
  return { guarded, invoke, onResult, runner, controller,
    args: { invoke, onResult, environment, signal: controller.signal } }
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden') })) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it.each([
  { mode: 'production' }, { mode: 'development' }, { flag: undefined }, { flag: 'false' },
  { backend: STAGE_BACKEND + '/' }, { backend: 'https://other.supabase.co' },
  { origin: 'https://stage-app.qvesta.ru' }, { origin: 'http://localhost:5173' },
  { pathname: '/' }, { search: '?enable=true' }, { hash: '#anything' },
])('blocks environment override at run AND transport %j', async patch => {
  const env = () => ({ ...allowed, ...patch }), fetcher = vi.fn(), invoke = vi.fn()
  expect(diagnosticAllowed(env())).toBe(false)
  await createDiagnosticRun().run({ invoke, environment: env, signal: init().signal, onResult: vi.fn() })
  await expect(createDiagnosticFetch(fetcher, env)(endpoint, init())).rejects.toThrow()
  expect(invoke).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})
it('keeps a closed scope closed after returning to stage', async () => {
  let current = allowed
  const scope = createDiagnosticScope(() => current)
  expect(scope.allowed()).toBe(true)
  current = { ...allowed, mode: 'production' }
  expect(scope.allowed()).toBe(false)
  current = allowed
  expect(scope.allowed()).toBe(false)
  const factory = vi.fn()
  expect(createDiagnosticClient(factory, STAGE_BACKEND, 'mock-public', vi.fn(), environment, scope)).toBeNull()
  expect(factory).not.toHaveBeenCalled()
})
it.each([
  [503, 'configuration_unavailable', 'handler_off'], [403, 'origin_denied', 'handler_origin'],
  [401, 'authentication_required', 'handler_auth'], [400, 'invalid_request', 'handler_request'],
  [503, 'receipt_unavailable', 'handler_context'], [503, 'request_mismatch', 'handler_context'],
  [503, 'contract_unavailable', 'handler_context'], [503, 'storage_unavailable', 'handler_context'],
  [503, 'request_unavailable', 'handler_unknown'],
])('keeps allowlisted HTTP code %s %s', async (status, error, layer) => {
  const h = harness(vi.fn(async () => response({ error }, status, { 'sb-request-id': ORDER_ID })))
  await h.runner.run(h.args)
  expect(h.onResult).toHaveBeenCalledWith({ endpoint: 'shop-checkout', stage: 'availability',
    status, code: error, layer, outcome: 'http_error', requestId: ORDER_ID, durationMs: expect.any(Number) })
})
it.each(['UNAUTHORIZED_INVALID_JWT_FORMAT', 'UNAUTHORIZED_NO_AUTH_HEADER'])('recognizes exact gateway code %s', code => {
  const message = code === 'UNAUTHORIZED_NO_AUTH_HEADER' ? 'Missing authorization header' : 'Invalid JWT'
  expect(safeResult(401, { code, message }, ORDER_ID)).toMatchObject({ code, layer: 'gateway_signature', outcome: 'http_error' })
  expect(safeResult(401, { code, message: 'private' }, ORDER_ID).code).toBe('UNKNOWN')
})
it('one exact availability, double click and remount reuse blocked, no header inspection', async () => {
  const fetcher = vi.fn(async () => off()), h = harness(fetcher)
  await Promise.all([h.runner.run(h.args), h.runner.run(h.args)])
  await h.runner.run(h.args)
  expect(h.invoke).toHaveBeenCalledTimes(1)
  expect(h.invoke.mock.calls[0]).toEqual(['shop-checkout', { method: 'POST',
    body: { orderId: ORDER_ID, action: 'availability' }, signal: expect.any(AbortSignal) }])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1]).toMatchObject({ body, redirect: 'error', credentials: 'omit', cache: 'no-store' })
  await expect(h.guarded(endpoint, init())).rejects.toThrow()
  const opaque = new Proxy({}, { get() { throw Error('Credentials inspected') } })
  const f = vi.fn(async () => off())
  await createDiagnosticFetch(f, environment)(endpoint, { ...init(), headers: opaque })
  expect(f.mock.calls[0][1].headers).toBe(opaque)
})
it.each([
  ['/rest/v1/rpc/create_shop_order', 'POST', body], ['/auth/v1/token', 'POST', '{}'],
  ['/functions/v1/shop-reconciliation-worker', 'POST', '{}'], ['/functions/v1/shop-reconcile', 'POST', body],
  ['/functions/v1/shop-checkout', 'GET', body], ['/functions/v1/shop-checkout', 'POST', '{}'],
  ['/functions/v1/shop-checkout', 'POST', JSON.stringify({ orderId: ORDER_ID })],
  ['/functions/v1/shop-checkout', 'POST', JSON.stringify({ orderId: ORDER_ID, action: 'checkout' })],
  ['/functions/v1/shop-checkout', 'POST', JSON.stringify({ orderId: ORDER_ID, action: 'availability', extra: true })],
  ['/functions/v1/shop-checkout?extra=true', 'POST', body],
])('blocks all other traffic %s %s', async (path, method, payload) => {
  const fetcher = vi.fn()
  await expect(createDiagnosticFetch(fetcher, environment)(STAGE_BACKEND + path, { ...init(), method, body: payload })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('blocks missing/aborted signal before fetch', async () => {
  const f = vi.fn(), guard = createDiagnosticFetch(f, environment), controller = new AbortController()
  controller.abort()
  await expect(guard(endpoint, { method: 'POST', body })).rejects.toThrow()
  await expect(guard(endpoint, { ...init(), signal: controller.signal })).rejects.toThrow()
  expect(f).not.toHaveBeenCalled()
})
it.each([
  () => response({ private: 'secret' }, 200),
  () => response({ error: 'receipt_unavailable', private: 'secret' }, 503),
  () => response({ private: 'secret'.repeat(500) }, 200),
  () => new Response('secret', { status: 200, headers: { 'content-type': 'text/html' } }),
  () => new Response('{secret', { status: 200, headers: { 'content-type': 'application/json' } }),
  () => new Response(null, { status: 204 }),
  () => response({ orderId: 'wrong', status: 'available' }, 200),
  () => response({ orderId: ORDER_ID, status: 'available', confirmationUrl: 'https://private.invalid' }, 200),
])('sanitizes malformed, extra, oversized and non-JSON payloads', async make => {
  const h = harness(vi.fn(async () => make()))
  await h.runner.run(h.args)
  const row = h.onResult.mock.calls[0][0]
  expect(row.code).toBe('UNKNOWN')
  expect(row.outcome).toBe(row.status >= 300 ? 'http_error' : 'invalid_response')
  expect(JSON.stringify(row)).not.toMatch(/secret|private|confirmationUrl/)
})
it('successful availability never starts reconcile/create and remains unexpected while OFF', async () => {
  const f = vi.fn(async () => response({ orderId: ORDER_ID, status: 'available' }, 200)), h = harness(f)
  await h.runner.run(h.args)
  expect(f).toHaveBeenCalledTimes(1)
  expect(h.onResult.mock.calls[0][0]).toMatchObject({ status: 200, outcome: 'unexpected_available_while_off' })
})
it('network failure is distinct and consumes both guards', async () => {
  const f = vi.fn(async () => { throw Error('private transport detail') }), h = harness(f)
  await h.runner.run(h.args); await h.runner.run(h.args)
  expect(h.onResult.mock.calls[0][0]).toMatchObject({ status: null, outcome: 'network_error' })
  await expect(h.guarded(endpoint, init())).rejects.toThrow()
  expect(f).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(h.onResult.mock.calls)).not.toContain('private')
})
it('SDK failure before fetch is client_error, never fabricated HTTP/network', async () => {
  const onResult = vi.fn()
  await createDiagnosticRun().run({ environment, signal: init().signal, onResult,
    invoke: async () => ({ error: Error('secret'), data: { private: 'secret' } }) })
  expect(onResult.mock.calls[0][0]).toMatchObject({ status: null, outcome: 'client_error' })
  expect(JSON.stringify(onResult.mock.calls)).not.toContain('secret')
})
it.each(['sdk', 'body'])('timeout bounds stuck %s and prevents late output/retry', async kind => {
  vi.useFakeTimers()
  let finish
  const f = kind === 'body'
    ? vi.fn(async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }))
    : vi.fn(() => new Promise(resolve => { finish = resolve }))
  const h = harness(f)
  const pending = h.runner.run(h.args)
  await vi.advanceTimersByTimeAsync(DEADLINE_MS)
  await pending
  finish?.(off())
  await vi.advanceTimersByTimeAsync(1)
  await h.runner.run(h.args)
  expect(h.onResult).toHaveBeenCalledTimes(1)
  expect(h.onResult.mock.calls[0][0]).toMatchObject({ outcome: 'timeout', status: null, durationMs: DEADLINE_MS })
  expect(f).toHaveBeenCalledTimes(1)
  expect(f.mock.calls[0][1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
it('unmount cancels and suppresses late output', async () => {
  let finish
  const h = harness(vi.fn(() => new Promise(resolve => { finish = resolve })))
  const pending = h.runner.run(h.args)
  h.controller.abort()
  await pending
  finish(off()); await Promise.resolve()
  expect(h.onResult).not.toHaveBeenCalled()
  expect(h.runner.used()).toBe(true)
})
it('real installed SDK uses only guarded mock fetch, with no startup request', async () => {
  const fetcher = vi.fn(async () => off())
  const client = createDiagnosticClient(createClient, STAGE_BACKEND, 'synthetic-public-key', fetcher, environment, createDiagnosticScope(environment))
  const onResult = vi.fn(), runner = createDiagnosticRun()
  expect(fetcher).not.toHaveBeenCalled()
  await runner.run({ environment, signal: init().signal, onResult, invoke: (name, options) => client.functions.invoke(name, options) })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(onResult.mock.calls[0][0]).toMatchObject({ status: 503, code: 'configuration_unavailable', outcome: 'http_error' })
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
