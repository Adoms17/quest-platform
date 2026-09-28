import { createSubscriptionFiscalRefundEndpoint } from './subscriptionFiscalRefundEndpoint.js'
export function createSubscriptionFiscalRefundRuntime(getEnv,createClient,endpoint=createSubscriptionFiscalRefundEndpoint){
 const enabled=getEnv('YOOKASSA_SANDBOX_ENABLED')==='true'&&getEnv('ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED')==='true'
 const allowedOrigins=['http://localhost:5174','http://127.0.0.1:5174','http://127.0.0.1:5175','https://stage-admin.qvesta.ru']
 if(!enabled)return endpoint({enabled:false,allowedOrigins})
 const url=getEnv('SUPABASE_URL'),anonKey=getEnv('SUPABASE_ANON_KEY'),serviceKey=getEnv('SUPABASE_SERVICE_ROLE_KEY')
 const shopId=getEnv('YOOKASSA_SANDBOX_SHOP_ID'),secretKey=getEnv('YOOKASSA_SANDBOX_SECRET_KEY')
 if(!url||!anonKey||!serviceKey||!shopId||!secretKey)return endpoint({enabled:false,allowedOrigins})
 const options={auth:{persistSession:false,autoRefreshToken:false}}
 return endpoint({enabled:true,allowedOrigins,auth:createClient(url,anonKey,options).auth,
  service:createClient(url,serviceKey,options),providerConfig:{enabled:true,shopId,secretKey}})
}
