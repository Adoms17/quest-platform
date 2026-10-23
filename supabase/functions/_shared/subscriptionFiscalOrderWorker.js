import { runSubscriptionFiscalWorker } from './subscriptionFiscalWorker.js'
import { createSandboxWorkerHandler } from './sandboxWorkerHandler.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function runSubscriptionFiscalOrderWorker({targetOrderId,rpc,...options}){
 if(typeof targetOrderId!=='string'||!uuid.test(targetOrderId))throw Error('invalid_fiscal_worker_target')
 const scopedRpc=async(name,args)=>{
  if(!['list_subscription_fiscal_work','subscription_fiscal_worker_gateway'].includes(name))throw Error('invalid_fiscal_worker_rpc')
  const scopedName=name==='list_subscription_fiscal_work'?'list_subscription_fiscal_order_work':'subscription_fiscal_order_worker_gateway'
  const reply=await rpc(scopedName,{...args,p_target_order_id:targetOrderId})
  if(name==='list_subscription_fiscal_work'&&!reply.error&&(!Array.isArray(reply.data)||reply.data.some(item=>item?.orderId!==targetOrderId)))throw Error('invalid_fiscal_worker_target')
  return reply
 }
 return runSubscriptionFiscalWorker({...options,rpc:scopedRpc})
}
export function createSubscriptionFiscalOrderRuntime(getEnv,createClient,createProvider=createSandboxHttpClient){
 const targetOrderId=getEnv('YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ORDER_ID')
 const enabled=getEnv('YOOKASSA_SANDBOX_ENABLED')==='true'&&getEnv('YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED')==='true'
  &&typeof targetOrderId==='string'&&uuid.test(targetOrderId)
 return request=>createSandboxWorkerHandler({enabled,token:getEnv('YOOKASSA_SANDBOX_WORKER_TOKEN'),run:async()=>{
  if(request.headers.get('x-qvesta-order-id')!==targetOrderId||request.headers.get('x-qvesta-fiscal-mode')!==(getEnv('YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_DISPATCH')==='true'?'dispatch':'reconcile'))throw Error('acceptance_configuration_mismatch')
  const url=getEnv('SUPABASE_URL'),key=getEnv('SUPABASE_SERVICE_ROLE_KEY'),shopId=getEnv('YOOKASSA_SANDBOX_SHOP_ID'),secretKey=getEnv('YOOKASSA_SANDBOX_SECRET_KEY')
  if(!url||!key||!shopId||!secretKey)throw Error('missing_config')
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  return runSubscriptionFiscalOrderWorker({targetOrderId,rpc:client.rpc.bind(client),shopId,reconciliationEnabled:true,
   dispatchEnabled:getEnv('YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_DISPATCH')==='true',
   createProvider:options=>createProvider({enabled:true,shopId,secretKey},options)})
 }})(request)
}
