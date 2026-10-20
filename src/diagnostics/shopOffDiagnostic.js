// Temporary, single-use availability diagnostic. No credential inspection.
export const DIAGNOSTIC_PATH = '/__stage/shop-off-diagnostic'
export const STAGE_ORIGIN = 'https://stage.qvesta.ru'
export const STAGE_BACKEND = 'https://jeugfyaqzfgdvfhdxfht.supabase.co'
export const DEADLINE_MS = 15000
export const ORDER_ID = 'afa9d8ae-ccc2-4cd0-babd-9d3b440f60a1'
const ENDPOINT = 'shop-checkout'
const BODY = JSON.stringify({ orderId: ORDER_ID, action: 'availability' })

export function diagnosticAllowed({ mode, flag, backend, origin, pathname, search = '', hash = '' }) {
  return mode === 'staging' && flag === 'true' && backend === STAGE_BACKEND
    && origin === STAGE_ORIGIN && pathname === DIAGNOSTIC_PATH && !search && !hash
}

export function diagnosticEnvironment() {
  return { mode: import.meta.env.MODE, flag: import.meta.env.VITE_SHOP_OFF_DIAGNOSTIC,
    backend: import.meta.env.VITE_SUPABASE_URL, origin: window.location.origin,
    pathname: window.location.pathname, search: window.location.search, hash: window.location.hash }
}

export function createDiagnosticScope(environment) {
  let closed = false
  return {
    allowed() {
      if (!closed && !diagnosticAllowed(environment())) closed = true
      return !closed
    },
    close() { closed = true },
  }
}

// The same irreversible scope spans bootstrap, async import, SDK init and fetch.
export const diagnosticScope = createDiagnosticScope(diagnosticEnvironment)

export function createDiagnosticClient(createClient, url, publicKey, fetcher, environment, scope) {
  if (!scope.allowed()) return null // Never initialize a normal SDK as fallback.
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createDiagnosticFetch(fetcher, environment, scope) },
  })
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ERRORS = {
  configuration_unavailable: [503, 'handler_off'],
  origin_denied: [403, 'handler_origin'],
  authentication_required: [401, 'handler_auth'],
  invalid_request: [400, 'handler_request'],
  invalid_order_id: [503, 'handler_context'],
  storage_unavailable: [503, 'handler_context'],
  contract_unavailable: [503, 'handler_context'],
  receipt_unavailable: [503, 'handler_context'],
  request_mismatch: [503, 'handler_context'],
  request_unavailable: [503, 'handler_unknown'],
}
const GATEWAY = {
  UNAUTHORIZED_NO_AUTH_HEADER: 'Missing authorization header',
  UNAUTHORIZED_INVALID_JWT_FORMAT: 'Invalid JWT',
}
const empty = outcome => ({ status: null, code: 'UNKNOWN', layer: 'unknown', requestId: null, outcome })

export function safeResult(status, payload, requestId) {
  const http = Number.isInteger(status) && status >= 200 && status <= 599 ? status : null
  const result = { ...empty(http !== null && http >= 300 ? 'http_error' : 'invalid_response'),
    status: http, requestId: typeof requestId === 'string' && UUID.test(requestId) ? requestId : null }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return result
  const keys = Object.keys(payload).sort().join(',')
  if (http === 200 && keys === 'orderId,status' && payload.orderId === ORDER_ID && payload.status === 'available') {
    return { ...result, code: 'available', layer: 'handler_available', outcome: 'unexpected_available_while_off' }
  }
  if (keys === 'error' && Object.hasOwn(ERRORS, payload.error) && ERRORS[payload.error][0] === http) {
    return { ...result, code: payload.error, layer: ERRORS[payload.error][1] }
  }
  if (http === 401 && keys === 'code,message' && Object.hasOwn(GATEWAY, payload.code)
    && payload.message === GATEWAY[payload.code]) return { ...result, code: payload.code, layer: 'gateway_signature' }
  return result
}

async function boundedResult(response, signal) {
  const id = response.headers.get('sb-request-id') || response.headers.get('x-request-id')
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    void response.body?.cancel().catch(() => {})
    return safeResult(response.status, null, id)
  }
  const reader = response.body?.getReader()
  if (!reader) return safeResult(response.status, null, id)
  let text = '', size = 0, abort
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    const interrupted = new Promise((_, reject) => {
      abort = () => { void reader.cancel().catch(() => {}); reject(new Error('Stopped')) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    while (true) {
      const { value, done } = await Promise.race([reader.read(), interrupted])
      if (done) break
      size += value.byteLength
      if (size > 2048) { void reader.cancel().catch(() => {}); return safeResult(response.status, null, id) }
      text += decoder.decode(value, { stream: true })
    }
    return safeResult(response.status, JSON.parse(text + decoder.decode()), id)
  } catch { return safeResult(response.status, null, id) }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
}

// SDK supplies headers internally. Never inspect credentials. Only one exact
// availability body with the runner's abort signal can cross this fetch guard.
export function createDiagnosticFetch(fetcher, environment, scope = createDiagnosticScope(environment)) {
  let sent = false
  return async (url, options = {}) => {
    if (!scope.allowed() || !diagnosticAllowed(environment()) || sent || !options.signal || options.signal.aborted
      || String(url) !== `${STAGE_BACKEND}/functions/v1/${ENDPOINT}`
      || options.method !== 'POST' || options.body !== BODY) throw new Error('Diagnostic transport closed')
    sent = true // Consumed before transport, including network errors.
    let result
    try {
      const response = await fetcher(url, { ...options, redirect: 'error', credentials: 'omit', cache: 'no-store' })
      result = await boundedResult(response, options.signal)
    } catch { result = empty('network_error') }
    // Internal SDK envelope, not the remote status: only result.status is shown.
    // Raw bodies and headers never reach the SDK or UI.
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

function normalizedResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty('invalid_response')
  const status = Number.isInteger(value.status) && value.status >= 200 && value.status <= 599 ? value.status : null
  const requestId = typeof value.requestId === 'string' && UUID.test(value.requestId) ? value.requestId : null
  let row = { ...empty(status !== null && status >= 300 ? 'http_error' : 'invalid_response'), status, requestId }
  if (status === null && value.outcome === 'network_error') return empty('network_error')
  if (Object.hasOwn(ERRORS, value.code) && ERRORS[value.code][0] === status) {
    row = { ...row, code: value.code, layer: ERRORS[value.code][1] }
  } else if (status === 401 && Object.hasOwn(GATEWAY, value.code)) {
    row = { ...row, code: value.code, layer: 'gateway_signature' }
  } else if (status === 200 && value.code === 'available' && value.outcome === 'unexpected_available_while_off') {
    row = { ...row, code: 'available', layer: 'handler_available', outcome: 'unexpected_available_while_off' }
  }
  return row
}

export function createDiagnosticRun() {
  let used = false
  return {
    used: () => used,
    async run({ invoke, environment, signal, onResult }) {
      if (used || signal.aborted || !diagnosticAllowed(environment())) return
      used = true // Shared across double clicks and remounts in this document.
      const started = performance.now(), controller = new AbortController()
      let timer, cancel, row = empty('client_error')
      try {
        const interrupted = new Promise(resolve => {
          cancel = () => { resolve(empty('canceled')); controller.abort() }
          signal.addEventListener('abort', cancel, { once: true })
          timer = setTimeout(() => { resolve(empty('timeout')); controller.abort() }, DEADLINE_MS)
        })
        const read = async () => {
          const value = await invoke(ENDPOINT, { method: 'POST', body: { orderId: ORDER_ID, action: 'availability' }, signal: controller.signal })
          // Fetch guard supplies a sanitized envelope. A pre-fetch SDK/auth
          // failure has no established HTTP or network outcome.
          return value?.error ? empty('client_error') : normalizedResult(value?.data)
        }
        row = await Promise.race([read(), interrupted])
      } catch { /* Never expose SDK errors, context or payload. */ }
      finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); controller.abort() }
      if (!signal.aborted && diagnosticAllowed(environment())) {
        onResult({ endpoint: ENDPOINT, stage: 'availability', ...row, durationMs: Math.max(0, Math.round(performance.now() - started)) })
      }
    },
  }
}

export const diagnosticRun = createDiagnosticRun()
