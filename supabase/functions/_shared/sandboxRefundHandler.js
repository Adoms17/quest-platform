const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// authenticate проверяет токен, authorize — владельца/MFA для конкретного резерва.
// Ни личность, ни сумму, ни контекст MFA нельзя принимать из JSON запроса.
export function createSandboxRefundHandler({ enabled = false, allowedOrigins = [], authenticate, authorize, execute }) {
 return async request => {
  const origin = request.headers.get('origin')
  const headers = {
   'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
   'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
   'Access-Control-Allow-Methods': 'POST, OPTIONS',
   ...(origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  }
  const reply = (body, status) => new Response(JSON.stringify(body), { status, headers })
  if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'origin_denied' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  if (!enabled) return reply({ error: 'sandbox_disabled' }, 503)
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'authentication_required' }, 401)
  let identity
  try { identity = await authenticate(authorization.slice(7)) } catch { return reply({ error: 'authentication_required' }, 401) }
  if (!identity || !uuid.test(identity.actorId)) return reply({ error: 'authentication_required' }, 401)
  let payload
  try {
   const reader = request.body?.getReader()
   if (!reader) return reply({ error: 'invalid_request' }, 400)
   const chunks = []; let size = 0
   while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 1024) { await reader.cancel(); return reply({ error: 'invalid_request' }, 400) }
    chunks.push(value)
   }
   const bytes = new Uint8Array(size); let offset = 0
   for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
   payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch { return reply({ error: 'invalid_request' }, 400) }
  if (!payload || Array.isArray(payload) || Object.keys(payload).length !== 1 || !uuid.test(payload.refundId)) return reply({ error: 'invalid_request' }, 400)
  try {
   if (await authorize(identity, payload.refundId) !== true) return reply({ error: 'refund_access_denied' }, 403)
  } catch { return reply({ error: 'refund_access_denied' }, 403) }
  try {
   const result = await execute(identity, payload.refundId)
   if (result?.id !== payload.refundId || !['reserved','sending','pending','succeeded','canceled','rejected','review'].includes(result.state)) throw new Error('invalid_result')
   return reply({ refundId: result.id, state: result.state, environment: 'sandbox', accessEffect: 'unchanged' }, 200)
  } catch {
   // Сбой не означает отмену: клиент восстанавливает ту же операцию по refundId.
   return reply({ error: 'sandbox_refund_unconfirmed', refundId: payload.refundId }, 503)
  }
 }
}
