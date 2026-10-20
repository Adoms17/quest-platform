// Независимый от Supabase JWT секрет только для запуска sandbox-worker.
// Генерируется из 32 случайных байт в hex; не передаётся во frontend.
export function createSandboxWorkerHandler({ token, enabled = false, run }) {
  return async request => {
    const headers = { 'Cache-Control': 'no-store' }
    const reply = status => new Response(null, { status, headers })
    if (request.method !== 'POST') return reply(405)
    const supplied = request.headers.get('x-qvesta-worker-token')
    if (!/^[a-f0-9]{64}$/.test(token ?? '') || !/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply(401)
    const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
    const [expected, actual] = await Promise.all([digest(token), digest(supplied)])
    let difference = 0
    for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i]
    if (difference !== 0) return reply(401)
    if (!enabled) return reply(503)
    try { return Response.json(await run(), { headers }) }
    catch { return reply(503) }
  }
}
