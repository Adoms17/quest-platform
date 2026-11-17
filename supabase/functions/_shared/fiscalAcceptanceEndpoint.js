import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function payload(request){
 const reader=request.body?.getReader();if(!reader)throw Error('invalid_request')
 const chunks=[];let size=0
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength
  if(size>1024){await reader.cancel();throw Error('invalid_request')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 const value=JSON.parse(new TextDecoder().decode(bytes))
 if(!value||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'fixtureId')||!Object.hasOwn(value,'email')
  ||typeof value.fixtureId!=='string'||!uuid.test(value.fixtureId)||typeof value.email!=='string'
  ||value.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))throw Error('invalid_request')
 return value
}
function summary(value,fixtureId){
 if(value?.fixtureId!==fixtureId||!uuid.test(value.orderId)||!uuid.test(value.organizationId)
  ||value.amountMinor!==99000||value.shopId!=='1467641'||value.environment!=='sandbox'
  ||typeof value.periodStart!=='string'||typeof value.periodEnd!=='string'
  ||!Number.isFinite(Date.parse(value.periodStart))||Date.parse(value.periodEnd)-Date.parse(value.periodStart)!==1800000)throw Error('invalid_result')
 return Object.fromEntries(['fixtureId','orderId','organizationId','amountMinor','periodStart','periodEnd','shopId','environment'].map(key=>[key,value[key]]))
}
export function createFiscalAcceptanceEndpoint({enabled=false,allowedOrigins=[],auth,service}){
 return async request=>{
  const origin=request.headers.get('origin')
  const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin',
   'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
   'Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowedOrigins.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}
  const reply=(body,code)=>new Response(JSON.stringify(body),{status:code,headers})
  if(origin&&!allowedOrigins.includes(origin))return reply({error:'origin_denied'},403)
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405)
  if(enabled!==true)return reply({error:'sandbox_disabled'},503)
  const bearer=request.headers.get('authorization'),token=bearer?.startsWith('Bearer ')?bearer.slice(7):null
  const identity=token?await authenticateRefundOwner(auth,token):null
  if(!identity)return reply({error:'authentication_required'},401)
  let input
  try{input=await payload(request)}catch{return reply({error:'invalid_request'},400)}
  try{
   const {data,error}=await service.rpc('prepare_fiscal_acceptance_from_gateway',{
    p_actor_user_id:identity.actorId,p_mfa_at:identity.mfaAt,p_expires_at:identity.expiresAt,
    p_fixture_id:input.fixtureId,p_email:input.email})
   if(error?.code==='42501')return reply({error:'fixture_access_denied'},403)
   if(error)throw Error('unconfirmed')
   return reply(summary(data,input.fixtureId),200)
  }catch{return reply({error:'fixture_preparation_unconfirmed'},503)}
 }
}
export function createFiscalAcceptanceRuntime(getEnv,createClient){
 const allowedOrigins=['https://stage-admin.qvesta.ru']
 const enabled=getEnv('YOOKASSA_SANDBOX_ENABLED')==='true'&&getEnv('ADMIN_FISCAL_ACCEPTANCE_PREPARE_ENABLED')==='true'
 if(!enabled)return createFiscalAcceptanceEndpoint({enabled:false,allowedOrigins})
 const url=getEnv('SUPABASE_URL'),anonKey=getEnv('SUPABASE_ANON_KEY'),serviceKey=getEnv('SUPABASE_SERVICE_ROLE_KEY')
 if(url!=='https://jeugfyaqzfgdvfhdxfht.supabase.co'||!anonKey||!serviceKey)return createFiscalAcceptanceEndpoint({enabled:false,allowedOrigins})
 const options={auth:{persistSession:false,autoRefreshToken:false}}
 return createFiscalAcceptanceEndpoint({enabled:true,allowedOrigins,auth:createClient(url,anonKey,options).auth,service:createClient(url,serviceKey,options)})
}
