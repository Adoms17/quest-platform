import { afterEach, expect, it, vi } from 'vitest'
import { createDiagnosticFetch, createDiagnosticRun, diagnosticAllowed, safeResult,
  STAGE_BACKEND, STAGE_ORIGIN, DIAGNOSTIC_PATH, DEADLINE_MS } from './shopOffDiagnostic'

const allowed = { mode: 'staging', flag: 'true', backend: STAGE_BACKEND, origin: STAGE_ORIGIN, pathname: DIAGNOSTIC_PATH }
const environment = () => allowed
const response = (body, status = 503, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
})
const off = () => response({ status: 503, code: 'configuration_unavailable', layer: 'handler_off', requestId: null })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it.each([
  { mode: 'production' }, { mode: 'development' }, { flag: undefined }, { flag: 'false' },
  { backend: `${STAGE_BACKEND}/` }, { backend: 'https://other.supabase.co' },
  { origin: 'https://stage-app.qvesta.ru' }, { origin: 'http://localhost:5173' },
  { pathname: '/' }, { search: '?enable=true' }, { hash: '#anything' },
])('fails closed for environment override %j', patch => {
  expect(diagnosticAllowed({ ...allowed, ...patch })).toBe(false)
})

it('permits only the exact documented stage environment', () => expect(diagnosticAllowed(allowed)).toBe(true))

it.each([
  [503, { error: 'configuration_unavailable' }, 'handler_off'],
  [403, { error: 'origin_denied' }, 'handler_origin'],
  [401, { code: 'UNAUTHORIZED_INVALID_JWT_FORMAT', message: 'Invalid JWT' }, 'gateway_signature'],
  [401, { code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }, 'gateway_signature'],
  [401, { code: 401, message: 'arbitrary private text' }, 'unknown'],
  [503, { error: 'configuration_unavailable', private: 'do not show' }, 'unknown'],
  [200, { error: 'configuration_unavailable' }, 'unknown'],
  [503, ['configuration_unavailable'], 'unknown'],
])('redacts and bounds response interpretation (%i)', (status, data, layer) => {
  const result = safeResult(status, data, 'unsafe-request-id')
  expect(result.layer).toBe(layer)
  expect(result.requestId).toBeNull()
  expect(JSON.stringify(result)).not.toMatch(/arbitrary|private|do not show/)
})

it('transport permits two ordered empty POSTs and never inspects SDK headers', async () => {
  const fetcher = vi.fn(async () => response({ error: 'configuration_unavailable' }))
  const guarded = createDiagnosticFetch(fetcher, environment)
  const opaqueHeaders = new Proxy({}, { get() { throw Error('Do not inspect credentials') } })
  for (const name of ['shop-checkout', 'shop-reconcile']) {
    const r = await guarded(`${STAGE_BACKEND}/functions/v1/${name}`, { method: 'POST', body: '{}', headers: opaqueHeaders })
    expect(await r.json()).toMatchObject({ code: 'configuration_unavailable' })
  }
  await expect(guarded(`${STAGE_BACKEND}/functions/v1/shop-checkout`, { method: 'POST', body: '{}' })).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' })
})

it.each([
  ['/rest/v1/rpc/create_shop_order', 'POST', '{}'], ['/auth/v1/token', 'POST', '{}'],
  ['/functions/v1/shop-reconciliation-worker', 'POST', '{}'], ['/functions/v1/shop-reconcile', 'POST', '{}'],
  ['/functions/v1/shop-checkout', 'GET', '{}'], ['/functions/v1/shop-checkout', 'POST', '{"orderId":"anything"}'],
  ['/functions/v1/shop-checkout?extra=true', 'POST', '{}'],
])('blocks unrelated or mutation-shaped traffic %s %s', async (path, method, body) => {
  const fetcher = vi.fn(() => { throw Error('Network forbidden') })
  const guarded = createDiagnosticFetch(fetcher, environment)
  await expect(guarded(STAGE_BACKEND + path, { method, body })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('redacts large and non-JSON payloads before SDK receives them', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ message: 'private'.repeat(500) }))
    .mockResolvedValueOnce(new Response('private', { status: 403, headers: { 'content-type': 'text/html' } }))
  const guarded = createDiagnosticFetch(fetcher, environment)
  for (const name of ['shop-checkout', 'shop-reconcile']) {
    const r = await guarded(`${STAGE_BACKEND}/functions/v1/${name}`, { method: 'POST', body: '{}' })
    expect(await r.text()).not.toContain('private')
  }
})

it('single-use run blocks double click and remount reuse; exact two POST bodies', async () => {
  const runner = createDiagnosticRun(), rows = []
  const invoke = vi.fn(async () => ({ response: off() }))
  const args = { invoke, environment, signal: new AbortController().signal, onResult: row => rows.push(row) }
  await Promise.all([runner.run(args), runner.run(args)])
  await runner.run(args)
  expect(invoke.mock.calls.map(c => c[0])).toEqual(['shop-checkout', 'shop-reconcile'])
  expect(invoke.mock.calls.every(c => c[1].method === 'POST' && Object.keys(c[1].body).length === 0)).toBe(true)
  expect(rows).toHaveLength(2)
  expect(runner.used()).toBe(true)
})

it.each([401, 403, 200, 500])('stops after first unexpected response %i', async status => {
  const invoke = vi.fn(async () => ({ response: response(safeResult(status, {}, null), status) }))
  await createDiagnosticRun().run({ invoke, environment, signal: new AbortController().signal, onResult: vi.fn() })
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('timeout bounds a stuck SDK and prevents retry/late continuation', async () => {
  vi.useFakeTimers()
  let finish
  const runner = createDiagnosticRun(), onResult = vi.fn()
  const invoke = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const args = { invoke, environment, onResult, signal: new AbortController().signal }
  const pending = runner.run(args)
  await vi.advanceTimersByTimeAsync(DEADLINE_MS)
  await pending
  finish({ response: off() })
  await Promise.resolve()
  await runner.run(args)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(onResult).toHaveBeenCalledTimes(1)
  expect(onResult.mock.calls[0][0].code).toBe('UNKNOWN')
  expect(vi.getTimerCount()).toBe(0)
})

it('abort on unmount suppresses late output and the second endpoint', async () => {
  let finish
  const runner = createDiagnosticRun(), controller = new AbortController(), onResult = vi.fn()
  const invoke = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const pending = runner.run({ invoke, environment, onResult, signal: controller.signal })
  controller.abort()
  await pending
  finish({ response: off() })
  await Promise.resolve()
  expect(onResult).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(runner.used()).toBe(true)
})

it('rechecks stage scope before each call', async () => {
  let env = allowed
  const invoke = vi.fn(async () => { env = { ...allowed, mode: 'production' }; return { response: off() } })
  await createDiagnosticRun().run({ invoke, environment: () => env, signal: new AbortController().signal, onResult: vi.fn() })
  expect(invoke).toHaveBeenCalledTimes(1)
})
