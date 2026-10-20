import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { handleShopPaymentRequest } from '../_shared/shopPaymentAdapter.js'

// Deployment and approved merchant/fiscal configuration are separate decisions.
// No test-only transport or contract is enabled by this runtime entrypoint.
Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const config = {
    enabled: Deno.env.get('SHOP_PAYMENT_ENABLED') === 'true' && !!url && !!anon && !!serviceKey,
    approved: Deno.env.get('SHOP_PAYMENT_CONFIGURATION_APPROVED') === 'true',
    merchant: Deno.env.get('SHOP_PAYMENT_MERCHANT'), environment: Deno.env.get('SHOP_PAYMENT_ENVIRONMENT'),
    returnOrigin: Deno.env.get('SHOP_PAYMENT_RETURN_ORIGIN'), secretKey: Deno.env.get('SHOP_PAYMENT_SECRET_KEY'),
  }
  return handleShopPaymentRequest(request, { config, mode: 'checkout',
    authenticate: async (token: string) => {
      const client = createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data, error } = await client.auth.getUser(token)
      return error ? null : data.user?.id
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      const service = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
      return service.rpc(name, args)
    },
  })
})
