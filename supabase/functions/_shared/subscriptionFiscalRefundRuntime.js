import { createSubscriptionFiscalRefundEndpoint } from './subscriptionFiscalRefundEndpoint.js'
export function createSubscriptionFiscalRefundRuntime(getEnv,createClient,endpoint=createSubscriptionFiscalRefundEndpoint){
 const candidate=getEnv('ADMIN_SUBSCRIPTION_FISCAL_STATUS_COMMAND_ID')
 const statusCommandId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate||'')?candidate:null
 // A malformed configured target must not fall back to financial execution.
 const invalidTarget=!!candidate&&!statusCommandId
 const enabled=!statusCommandId&&!invalidTarget&&getEnv('YOOKASSA_SANDBOX_ENABLED')==='true'&&getEnv('ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED')==='true'
 const allowedOrigins=['http://localhost:5174','http://127.0.0.1:5174','http://127.0.0.1:5175','https://stage-admin.qvesta.ru']
 if(invalidTarget||(!enabled&&!statusCommandId))return endpoint({enabled:false,allowedOrigins})
 const url=getEnv('SUPABASE_URL'),anonKey=getEnv('SUPABASE_ANON_KEY'),serviceKey=getEnv('SUPABASE_SERVICE_ROLE_KEY')
 const shopId=getEnv('YOOKASSA_SANDBOX_SHOP_ID'),secretKey=enabled?getEnv('YOOKASSA_SANDBOX_SECRET_KEY'):null
 if(!url||!anonKey||!serviceKey||!shopId||(enabled&&!secretKey))return endpoint({enabled:false,allowedOrigins})
 const options={auth:{persistSession:false,autoRefreshToken:false}}
 return endpoint({enabled,statusCommandId,allowedOrigins,auth:createClient(url,anonKey,options).auth,
  service:createClient(url,serviceKey,options),providerConfig:{enabled,shopId,secretKey}})
}
