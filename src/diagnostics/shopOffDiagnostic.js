// Temporary diagnostic only. No credentials, order identities or persistence.
export const DIAGNOSTIC_PATH = '/__stage/shop-off-diagnostic'
export const STAGE_ORIGIN = 'https://stage.qvesta.ru'
export const STAGE_BACKEND = 'https://jeugfyaqzfgdvfhdxfht.supabase.co'
export const DEADLINE_MS = 15000
const ENDPOINTS = ['shop-checkout', 'shop-reconcile']

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

export function safeResult(status, payload, requestId) {
  const result = { status: Number.isInteger(status) ? status : null, code: 'UNKNOWN', layer: 'unknown',
    requestId: typeof requestId === 'string' && /^[a-f0-9-]{36}$/i.test(requestId) ? requestId : null }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return result
  const keys = Object.keys(payload).sort().join(',')
  if (status === 503 && keys === 'error' && payload.error === 'configuration_unavailable') {
    return { ...result, code: 'configuration_unavailable', layer: 'handler_off' }
  }
  if (status === 403 && keys === 'error' && payload.error === 'origin_denied') {
    return { ...result, code: 'origin_denied', layer: 'handler_origin' }
  }
  const gateway = {
    UNAUTHORIZED_NO_AUTH_HEADER: 'Missing authorization header',
    UNAUTHORIZED_INVALID_JWT_FORMAT: 'Invalid JWT',
  }
  if (status === 401 && keys === 'code,message' && Object.hasOwn(gateway, payload.code)
    && payload.message === gateway[payload.code]) return { ...result, code: payload.code, layer: 'gateway_signature' }
  return result
}

async function boundedResult(response) {
  const id = response.headers.get('sb-request-id') || response.headers.get('x-request-id')
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    void response.body?.cancel().catch(() => {})
    return safeResult(response.status, null, id)
  }
  const reader = response.body?.getReader()
  if (!reader) return safeResult(response.status, null, id)
  let text = '', size = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2048) { void reader.cancel().catch(() => {}); return safeResult(response.status, null, id) }
      text += decoder.decode(value, { stream: true })
    }
    return safeResult(response.status, JSON.parse(text + decoder.decode()), id)
  } catch { return safeResult(response.status, null, id) }
  finally { reader.releaseLock() }
}

// SDK supplies headers internally; this guard never reads or logs them. All
// non-probe fetches (including auth refresh, RPC and storage) are blocked here.
export function createDiagnosticFetch(fetcher, environment, scope = createDiagnosticScope(environment)) {
  let sent = 0
  return async (url, options = {}) => {
    if (!scope.allowed() || !diagnosticAllowed(environment()) || sent >= 2 || options.signal?.aborted
      || String(url) !== `${STAGE_BACKEND}/functions/v1/${ENDPOINTS[sent]}`
      || options.method !== 'POST' || options.body !== '{}') throw new Error('Diagnostic transport closed')
    sent += 1
    const response = await fetcher(url, { ...options, redirect: 'error', credentials: 'omit', cache: 'no-store' })
    const result = await boundedResult(response)
    // Only a normalized safe record reaches SDK parsing or the UI. Even 2xx
    // cannot expose an arbitrary response body or trigger the second request.
    return new Response(JSON.stringify(result), { status: response.status, headers: { 'Content-Type': 'application/json' } })
  }
}

export function createDiagnosticRun() {
  let used = false
  return {
    used: () => used,
    async run({ invoke, environment, signal, onResult }) {
      if (used || signal.aborted || !diagnosticAllowed(environment())) return
      used = true // Survives component remount; never unlock on errors/unmount.
      for (const endpoint of ENDPOINTS) {
        if (signal.aborted || !diagnosticAllowed(environment())) break
        const controller = new AbortController()
        let timer, cancel
        let row = { status: null, code: 'UNKNOWN', layer: 'unknown', requestId: null }
        try {
          const interrupted = new Promise((_, reject) => {
            cancel = () => { controller.abort(); reject(new Error('Diagnostic stopped')) }
            signal.addEventListener('abort', cancel, { once: true })
            timer = setTimeout(cancel, DEADLINE_MS)
          })
          const read = async () => {
            const value = await invoke(endpoint, { method: 'POST', body: {}, signal: controller.signal })
            return value.response ? await value.response.json() : null
          }
          const value = await Promise.race([read(), interrupted])
          if (value && ['UNKNOWN', 'configuration_unavailable', 'origin_denied',
            'UNAUTHORIZED_NO_AUTH_HEADER', 'UNAUTHORIZED_INVALID_JWT_FORMAT'].includes(value.code)) {
            row = { status: Number.isInteger(value.status) ? value.status : null, code: value.code,
              layer: ['unknown', 'handler_off', 'handler_origin', 'gateway_signature'].includes(value.layer) ? value.layer : 'unknown',
              requestId: typeof value.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(value.requestId) ? value.requestId : null }
          }
        } catch { /* Never surface SDK error/context, credentials or raw payload. */ }
        finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
        if (signal.aborted) break
        onResult({ endpoint, ...row })
        if (row.status !== 503 || row.code !== 'configuration_unavailable' || row.layer !== 'handler_off') break
      }
    },
  }
}

export const diagnosticRun = createDiagnosticRun()
