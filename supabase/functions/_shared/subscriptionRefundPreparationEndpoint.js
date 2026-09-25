import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createSubscriptionRefundPreparationEndpoint({ enabled = false, allowedOrigins = [], auth, service }) {
 return async request => {
  const origin = request.headers.get('origin')
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
   'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
   'Access-Control-Allow-Methods': 'POST, OPTIONS',
   ...(origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) }
  const reply = (body, status) => new Response(JSON.stringify(body), { status, headers })
  if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'origin_denied' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  if (!enabled) return reply({ error: 'sandbox_disabled' }, 503)
  const bearer = request.headers.get('authorization')
  const identity = bearer?.startsWith('Bearer ') ? await authenticateRefundOwner(auth, bearer.slice(7)) : null
  if (!identity) return reply({ error: 'authentication_required' }, 401)
  let payload
  try {
   const reader = request.body?.getReader()
   if (!reader) throw new Error('body')
   const chunks = []; let size = 0
   while (true) {
    const { done, value } = await reader.read(); if (done) break
    size += value.byteLength
    if (size > 1024) { await reader.cancel(); throw new Error('size') }
    chunks.push(value)
   }
   const bytes = new Uint8Array(size); let offset = 0
   for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
   payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch { return reply({ error: 'invalid_request' }, 400) }
  const key = payload?.action === 'request' ? 'commandId' : payload?.action === 'reserve' ? 'requestId' : null
  if (!key || !payload || Array.isArray(payload) || Object.keys(payload).length !== 4
   || !Object.keys(payload).every(k => ['action', 'organizationId', 'orderId', key].includes(k))
   || ![payload.organizationId, payload.orderId, payload[key]].every(v => typeof v === 'string' && uuid.test(v))) return reply({ error: 'invalid_request' }, 400)
  try {
   const { data, error } = await service.rpc('prepare_subscription_refund_from_gateway', {
    p_actor_user_id: identity.actorId, p_mfa_at: identity.mfaAt, p_expires_at: identity.expiresAt,
    p_action: payload.action, p_organization_id: payload.organizationId, p_order_id: payload.orderId,
    p_command_id: key === 'commandId' ? payload.commandId : null,
    p_request_id: key === 'requestId' ? payload.requestId : null,
   })
   if (error?.code === '42501') return reply({ error: 'refund_access_denied' }, 403)
   if (error || !data) throw new Error('unconfirmed')
   return reply(data, 200)
  } catch {
   // A lost response may hide a committed request/reservation; retry exactly the same identifiers.
   return reply({ error: 'refund_preparation_unconfirmed' }, 503)
  }
 }
}
