import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
function canonicalReceiptInstant(value) {
 if (typeof value !== 'string') return null
 const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
 if (!match) return null
 const [,y,m,d,h,min,s,fraction,zone] = match
 const parts = [y,m,d,h,min,s].map(Number)
 const [year,month,day,hour,minute,second] = parts
 if (year<1 || month<1 || month>12 || hour>23 || minute>59 || second>59) return null
 const base = new Date(0); base.setUTCFullYear(year,month-1,day); base.setUTCHours(hour,minute,second,Number((fraction||'').padEnd(3,'0')))
 if (base.getUTCFullYear()!==year || base.getUTCMonth()!==month-1 || base.getUTCDate()!==day) return null
 if (zone!=='Z' && (Number(zone.slice(1,3))>23 || Number(zone.slice(4))>59)) return null
 const instant = new Date(value)
 return Number.isFinite(instant.getTime()) && !instant.toISOString().startsWith('0000') ? instant.toISOString() : null
}
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
  const extended = payload?.action === 'request' && (Object.hasOwn(payload, 'receiptSource') || Object.hasOwn(payload, 'receivedAt'))
  const receiptTime = extended && payload.receiptSource === 'email' ? canonicalReceiptInstant(payload.receivedAt) : null
  if (!key || !payload || Array.isArray(payload) || Object.keys(payload).length !== (extended ? 6 : 4)
   || !Object.keys(payload).every(k => ['action', 'organizationId', 'orderId', key, ...(extended ? ['receiptSource', 'receivedAt'] : [])].includes(k))
   || ![payload.organizationId, payload.orderId, payload[key]].every(v => typeof v === 'string' && uuid.test(v))) return reply({ error: 'invalid_request' }, 400)
  if (extended && !((payload.receiptSource === 'email' && receiptTime) || (payload.receiptSource === 'inapp' && payload.receivedAt === null))) return reply({ error: 'invalid_receipt_time' }, 400)
  try {
   const { data, error } = await service.rpc('prepare_subscription_refund_from_gateway', {
    p_actor_user_id: identity.actorId, p_mfa_at: identity.mfaAt, p_expires_at: identity.expiresAt,
    p_action: payload.action, p_organization_id: payload.organizationId, p_order_id: payload.orderId,
    p_command_id: key === 'commandId' ? payload.commandId : null,
    p_request_id: key === 'requestId' ? payload.requestId : null,
    ...(extended ? { p_receipt_source: payload.receiptSource, p_received_at: receiptTime } : {}),
   })
   if (error?.code === 'PT409') return reply({ error: 'receipt_conflict' }, 409)
   if (error?.code === 'PT400' || error?.code === '22007' || error?.code === '22008') return reply({ error: 'invalid_receipt_time' }, 400)
   if (error?.code === '42501') return reply({ error: 'refund_access_denied' }, 403)
   if (error || !data) throw new Error('unconfirmed')
   return reply(data, 200)
  } catch {
   // A lost response may hide a committed request/reservation; retry exactly the same identifiers.
   return reply({ error: 'refund_preparation_unconfirmed' }, 503)
  }
 }
}
