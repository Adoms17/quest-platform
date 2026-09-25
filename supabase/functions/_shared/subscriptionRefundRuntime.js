import { createSubscriptionRefundEndpoint } from './subscriptionRefundEndpoint.js'

// Environment access and client construction are injected so disabled startup is testable.
export function createSubscriptionRefundRuntime(getEnv, createClient, endpoint = createSubscriptionRefundEndpoint) {
 const url = getEnv('SUPABASE_URL')
 const anonKey = getEnv('SUPABASE_ANON_KEY')
 const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
 const shopId = getEnv('YOOKASSA_SANDBOX_SHOP_ID')
 const secretKey = getEnv('YOOKASSA_SANDBOX_SECRET_KEY')
 const enabled = getEnv('YOOKASSA_SANDBOX_ENABLED') === 'true'
  && getEnv('ADMIN_SUBSCRIPTION_REFUNDS_ENABLED') === 'true'
  && !!url && !!anonKey && !!serviceKey && !!shopId && !!secretKey
 const options = { auth: { persistSession: false, autoRefreshToken: false } }
 return endpoint({
  enabled,
  allowedOrigins: ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'https://stage-admin.qvesta.ru'],
  auth: enabled ? createClient(url, anonKey, options).auth : null,
  service: enabled ? createClient(url, serviceKey, options) : null,
  providerConfig: { enabled, shopId, secretKey },
 })
}
