import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxHttpClient } from '../_shared/yookassaSandboxHttp.js'
import { runSandboxCheckout } from '../_shared/sandboxCheckout.js'
import { createSandboxCheckoutHandler, sandboxGatewayRpc } from '../_shared/sandboxCheckoutHandler.js'

Deno.serve(async request => {
  const url=Deno.env.get('SUPABASE_URL')
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const shopId=Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID')
  const secretKey=Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
  const enabled=Deno.env.get('YOOKASSA_SANDBOX_ENABLED')==='true' && !!url && !!anonKey && !!serviceKey && !!shopId && !!secretKey
  return createSandboxCheckoutHandler({
    enabled,
    allowedOrigins:['http://localhost:5174','http://127.0.0.1:5174','http://127.0.0.1:4173','https://stage.qvesta.ru'],
    authenticate:async (token:string) => {
      const client=createClient(url!,anonKey!,{auth:{persistSession:false,autoRefreshToken:false}})
      const {data,error}=await client.auth.getUser(token)
      return error ? null : data.user?.id
    },
    checkout:async (actor:string,orderId:string) => {
      const service=createClient(url!,serviceKey!,{auth:{persistSession:false,autoRefreshToken:false}})
      return runSandboxCheckout(orderId,{rpc:sandboxGatewayRpc(service,actor),provider:createSandboxHttpClient({enabled,shopId,secretKey})})
    },
  })(request)
})
