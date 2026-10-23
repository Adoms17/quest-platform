// Независимый от Supabase JWT секрет только для запуска sandbox-worker.
// Генерируется из 32 случайных байт в hex; не передаётся во frontend.
export function createSandboxWorkerHandler({ token, enabled = false, run, diagnostics = false }) {
  // Opt-in only. Runtime attaches execution/deployment metadata; no request data.
  const report = event => {
    if (diagnostics !== true) return
    try { console.info(event) } catch { /* Diagnostics must never affect responses. */ }
  }
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
    if (!enabled) {
      report('SHOP_WORKER_AUTHENTICATED_OFF_V1')
      return reply(503)
    }
    try { return Response.json(await run(), { headers }) }
    catch {
      report('SHOP_WORKER_RUN_FAILED_V1')
      return reply(503)
    }
  }
}
