import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxHttpClient } from '../_shared/yookassaSandboxHttp.js'
import { createSandboxReconciler } from '../_shared/sandboxReconciliation.js'
import { createSandboxRefundReconciler } from '../_shared/sandboxRefundReconciliation.js'

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey || request.headers.get('authorization') !== `Bearer ${serviceKey}`) return new Response(null, { status: 401 })
  const shopId = Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID'), secretKey = Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
  const enabled = Deno.env.get('YOOKASSA_SANDBOX_ENABLED') === 'true' && !!url && !!shopId && !!secretKey
  if (!enabled) return new Response(null, { status: 503 })
  try {
    const client = createClient(url!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const result = await createSandboxReconciler({ rpc: client.rpc.bind(client), provider: createSandboxHttpClient({ enabled, shopId, secretKey }), shopId }).batch()
    const refunds = await createSandboxRefundReconciler({ rpc: client.rpc.bind(client), provider: createSandboxHttpClient({ enabled, shopId, secretKey }), shopId }).batch()
    return Response.json({ ...result, refunds }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return new Response(null, { status: 503 }) }
})
