import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxWorkerHandler } from '../_shared/sandboxWorkerHandler.js'
import { runShopReconciliationWorker } from '../_shared/shopReconciliationWorker.js'

// Independent switch: closing new checkout must not stop confirmed delivery.
// No schedule/deployment is created here and no test-only contract is accepted.
Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const enabled = Deno.env.get('SHOP_RECONCILIATION_ENABLED') === 'true' && !!url && !!serviceKey
  const config = {
    enabled, approved: Deno.env.get('SHOP_PAYMENT_CONFIGURATION_APPROVED') === 'true',
    merchant: Deno.env.get('SHOP_PAYMENT_MERCHANT'), environment: Deno.env.get('SHOP_PAYMENT_ENVIRONMENT'),
    returnOrigin: Deno.env.get('SHOP_PAYMENT_RETURN_ORIGIN'), secretKey: Deno.env.get('SHOP_PAYMENT_SECRET_KEY'),
  }
  return createSandboxWorkerHandler({ token: Deno.env.get('SHOP_RECONCILIATION_WORKER_TOKEN'), enabled,
    diagnostics: true,
    run: async () => {
      const client = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
      return runShopReconciliationWorker({ enabled, config, rpc: client.rpc.bind(client), limit: 5 })
    },
  })(request)
})
