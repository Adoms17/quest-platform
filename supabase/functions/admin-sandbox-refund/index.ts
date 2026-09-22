import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createPlatformRefundEndpoint } from '../_shared/platformRefundEndpoint.js'

Deno.serve(async request => {
 const url = Deno.env.get('SUPABASE_URL')
 const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
 const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 const shopId = Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID')
 const secretKey = Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
 const enabled = Deno.env.get('YOOKASSA_SANDBOX_ENABLED') === 'true'
  && Deno.env.get('ADMIN_SANDBOX_REFUNDS_ENABLED') === 'true'
  && !!url && !!anonKey && !!serviceKey && !!shopId && !!secretKey
 const options = { auth: { persistSession: false, autoRefreshToken: false } }
 return createPlatformRefundEndpoint({
  enabled,
  allowedOrigins: ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'https://stage-admin.qvesta.ru'],
  auth: enabled ? createClient(url!, anonKey!, options).auth : null,
  service: enabled ? createClient(url!, serviceKey!, options) : null,
  providerConfig: { enabled, shopId, secretKey },
 })(request)
})
