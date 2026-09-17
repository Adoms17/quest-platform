const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function sandboxGatewayRpc(serviceClient, actorId) {
  const actions = { read_sandbox_payment_order: 'read', begin_sandbox_payment_send: 'begin', record_sandbox_payment_result: 'record' }
  return (name, args) => {
    if (!actions[name]) throw new Error('invalid_gateway_action')
    return serviceClient.rpc('sandbox_checkout_from_gateway', { p_actor_user_id: actorId, p_action: actions[name], p_order_id: args.p_order_id,
      p_payment: actions[name] === 'record' ? { paymentId: args.p_payment_id, status: args.p_status, paid: args.p_paid, test: args.p_test, confirmationUrl: args.p_confirmation_url } : null })
  }
}
export function createSandboxCheckoutHandler({ enabled = false, allowedOrigins = [], authenticate, checkout }) {
  return async request => {
    const origin = request.headers.get('origin')
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) }
    const reply = (body, status) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'origin_denied' },403)
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers})
    if (request.method !== 'POST') return reply({ error:'method_not_allowed' },405)
    if (!enabled) return reply({error:'sandbox_disabled'},503)
    const authorization=request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) return reply({error:'authentication_required'},401)
    try {
      const actor = await authenticate(authorization.slice(7))
      if (!actor || !uuid.test(actor)) return reply({error:'authentication_required'},401)
      let payload
      try {
        const reader=request.body?.getReader()
        if (!reader) return reply({error:'invalid_request'},400)
        const chunks=[]
        let size=0
        while (true) {
          const {done,value}=await reader.read()
          if(done) break
          size+=value.byteLength
          if(size>1024) { await reader.cancel(); return reply({error:'invalid_request'},400) }
          chunks.push(value)
        }
        const bytes=new Uint8Array(size)
        let offset=0
        for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.byteLength }
        payload=JSON.parse(new TextDecoder().decode(bytes))
      } catch { return reply({error:'invalid_request'},400) }
      if (!payload || Array.isArray(payload) || Object.keys(payload).length!==1 || !uuid.test(payload.orderId)) return reply({error:'invalid_request'},400)
      return reply(await checkout(actor,payload.orderId),200)
    } catch {
      // Ни ключи, ни сырые ошибки провайдера или БД не возвращаются клиенту.
      return reply({error:'sandbox_checkout_unconfirmed'},503)
    }
  }
}
