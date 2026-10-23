import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
import { createSubscriptionFiscalRefundStorage } from './subscriptionFiscalRefundStorage.js'
import { runSubscriptionFiscalOperation } from './subscriptionFiscalFlow.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function payload(request) {
 const reader=request.body?.getReader();if(!reader)throw Error('invalid_request')
 const chunks=[];let size=0
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength
  if(size>1024){await reader.cancel();throw Error('invalid_request')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 const value=JSON.parse(new TextDecoder().decode(bytes))
 const keys=value?.action==='reserve'?['action','organizationId','orderId','requestId']:['execute','status'].includes(value?.action)?['action','commandId']:null
 if(!keys||!value||Array.isArray(value)||Object.keys(value).length!==keys.length
  ||keys.some(key=>!Object.hasOwn(value,key)||(key!=='action'&&(typeof value[key]!=='string'||!uuid.test(value[key])))))throw Error('invalid_request')
 return value
}
function status(value,commandId){
 if(value?.commandId!==commandId||!uuid.test(value.refundId)||value.environment!=='sandbox'
  ||!['reserved','sending','pending','succeeded','canceled','rejected','review'].includes(value.state)
  ||!['reserved','unknown','pending','succeeded','canceled','rejected'].includes(value.operationState)
  ||![null,'unknown','pending','succeeded','canceled'].includes(value.receiptStatus)||typeof value.requiresReview!=='boolean'
  ||!['applied','not_applied','review_required','applied_review_required'].includes(value.accessEffect))throw Error('invalid_fiscal_status')
 return Object.fromEntries(['commandId','refundId','state','operationState','receiptStatus','requiresReview','accessEffect','environment'].map(key=>[key,value[key]]))
}
export function createSubscriptionFiscalRefundEndpoint({enabled=false,statusCommandId=null,allowedOrigins=[],auth,service,providerConfig,transport={}}){
 return async request=>{
  const origin=request.headers.get('origin')
  const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin',
   'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
   'Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowedOrigins.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}
  const reply=(body,code)=>new Response(JSON.stringify(body),{status:code,headers})
  if(origin&&!allowedOrigins.includes(origin))return reply({error:'origin_denied'},403)
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405)
  const statusOnly=uuid.test(statusCommandId || '')
  if(enabled!==true&&!statusOnly)return reply({error:'sandbox_disabled'},503)
  const bearer=request.headers.get('authorization'),token=bearer?.startsWith('Bearer ')?bearer.slice(7):null
  const identity=token?await authenticateRefundOwner(auth,token):null
  if(!identity)return reply({error:'authentication_required'},401)
  let input
  try{input=await payload(request)}catch{return reply({error:'invalid_request'},400)}
  // A configured acceptance target forces read-only mode, even if dispatch flags are on.
  if(statusOnly && (input.action!=='status'||input.commandId!==statusCommandId))return reply({error:'sandbox_disabled'},503)
  if(input.action==='status'&&!statusOnly)return reply({error:'sandbox_disabled'},503)
  const shopId=providerConfig?.shopId
  if(input.action==='reserve'){
   try{
    const {data,error}=await service.rpc('prepare_linked_fiscal_refund_from_gateway',{
     p_actor_user_id:identity.actorId,p_mfa_at:identity.mfaAt,p_expires_at:identity.expiresAt,p_shop_id:shopId,
     p_organization_id:input.organizationId,p_order_id:input.orderId,p_request_id:input.requestId,
    })
    if(error?.code==='42501')return reply({error:'refund_access_denied'},403)
    if(error||data?.requestId!==input.requestId||data.commandId!==input.requestId||!uuid.test(data.refundId))throw Error('unconfirmed')
    return reply({request_id:data.requestId,refund_id:data.refundId,fiscal_command_id:data.commandId},200)
   }catch{return reply({error:'refund_preparation_unconfirmed'},503)}
  }
  let storage
  try{storage=createSubscriptionFiscalRefundStorage({rpc:service.rpc.bind(service),identity,shopId,commandId:input.commandId})}catch{return reply({error:'sandbox_disabled'},503)}
  try{
   const current=status(await storage.status(),input.commandId)
   if(input.action==='status')return reply(current,200)
  }catch{return reply({error:'refund_access_denied'},403)}
  try{
   const provider=createSandboxHttpClient(providerConfig,{...transport,beforeFiscalSend:async operation=>{
    // Re-check Auth after provider GETs; roles, MFA, scope and access are rechecked in SQL.
    const fresh=await authenticateRefundOwner(auth,token)
    if(!fresh||fresh.actorId!==identity.actorId)throw Error('fiscal_send_denied')
    await storage.authorizeSend(operation)
   }})
   await runSubscriptionFiscalOperation({enabled:true,commandId:input.commandId,shopId,storage,provider})
   return reply(status(await storage.status(),input.commandId),200)
  }catch{return reply({error:'fiscal_refund_unconfirmed',commandId:input.commandId},503)}
 }
}
