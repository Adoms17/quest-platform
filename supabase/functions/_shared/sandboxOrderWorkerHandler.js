import { createSandboxWorkerHandler } from './sandboxWorkerHandler.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Queue-visible signatures authorize only one idempotent order reconciliation for 90 seconds.
export function createSandboxOrderWorkerHandler({ token, enabled = false, run, now = Date.now }) {
  const manual = createSandboxWorkerHandler({ token, enabled, run })
  return async request => {
    const signature = request.headers.get('x-qvesta-order-signature')
    const timestamp = request.headers.get('x-qvesta-order-timestamp')
    if (signature === null && timestamp === null) return manual(request)
    const headers = { 'Cache-Control': 'no-store' }
    const reply = status => new Response(null, { status, headers })
    if (request.method !== 'POST') return reply(405)
    const orderId = request.headers.get('x-qvesta-order-id')
    if (request.headers.has('x-qvesta-worker-token') || !uuid.test(orderId ?? '') || !/^[0-9]{10}$/.test(timestamp ?? '')
      || !/^[a-f0-9]{64}$/.test(signature ?? '') || !/^[a-f0-9]{64}$/.test(token ?? '')) return reply(401)
    const age = Math.floor(now() / 1000) - Number(timestamp)
    if (age < -5 || age > 90) return reply(401)
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex, 16))
    const message = `qvesta-order-reconcile-v1\n${orderId}\n${timestamp}`
    if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(message))) return reply(401)
    if (!enabled) return reply(503)
    try { return Response.json(await run(), { headers }) } catch { return reply(503) }
  }
}