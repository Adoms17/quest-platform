import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxWorkerHandler } from '../_shared/sandboxWorkerHandler.js'
import { createSandboxRecurringWorker } from '../_shared/sandboxRecurringWorker.js'
import { runSandboxRecurringBatch } from '../_shared/sandboxRecurringBatch.js'

Deno.serve(async request => {
 const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 const shopId = Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID'), secretKey = Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
 const organizationId = Deno.env.get('YOOKASSA_SANDBOX_RECURRING_ORGANIZATION_ID')
 const enabled = Deno.env.get('YOOKASSA_SANDBOX_ENABLED') === 'true'
  && Deno.env.get('YOOKASSA_SANDBOX_RECURRING_ENABLED') === 'true'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId ?? '')
  && !!url && !!serviceKey && !!shopId && !!secretKey
 return createSandboxWorkerHandler({ token: Deno.env.get('YOOKASSA_SANDBOX_WORKER_TOKEN'), enabled, run: async () => {
  const client = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  const rpc = client.rpc.bind(client)
  const worker = createSandboxRecurringWorker({ rpc, config: { enabled, shopId, secretKey } })
  return runSandboxRecurringBatch({ rpc, worker, shopId, organizationId })
 } })(request)
})
