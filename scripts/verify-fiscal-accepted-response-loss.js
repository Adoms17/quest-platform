// Test-only orchestration; service factories must point at an isolated fixture.
import assert from 'node:assert/strict'
import {createSubscriptionFiscalRefundEndpoint} from '../supabase/functions/_shared/subscriptionFiscalRefundEndpoint.js'
import {observeLossBoundary} from './fiscal-recovery-a-verifier.js'

export async function verifyFiscalAcceptedResponseLoss({commandId,actorId,shopId,createService,snapshot,onPost,afterAccepted,onSuppressed}) {
 const before=await snapshot(), trace=[], claims=[], accepted=[], posts=[]
 const services=[], rawFetch=globalThis.fetch
 let operation, networkCalls=0, afterLoss
 globalThis.fetch=()=>{networkCalls++;throw Error('Unexpected real network in accepted-response-loss test')}
 const refundId='99999999-9999-4999-8999-999999999999'
 const receiptId='ra-88888888-8888-4888-8888-888888888888'
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname, method=options.method
  trace.push(method+' '+path)
  assert.ok(operation,'claim must precede provider transport')
  const item=operation.body.receipt?.items?.[0]??operation.expectedItems?.[0]
  if(method==='POST'){
   onPost?.(structuredClone(operation),refundId)
   posts.push({path,key:options.headers['Idempotence-Key'],body:options.body})
   assert.equal(path,'/v3/refunds')
   assert.equal(posts.length,1,'no second refund POST, even with the same key')
   assert.equal(options.body,JSON.stringify(operation.body))
   assert.equal(options.headers['Idempotence-Key'],operation.key)
   // Provider state changes FIRST. The application receives no refund ID/body.
   accepted.push({id:refundId,paymentId:operation.paymentId,amountMinor:operation.amountMinor})
   trace.push('provider_accepted')
   await afterAccepted?.(structuredClone(operation),refundId)
   trace.push('response_lost')
   throw Error('synthetic response lost AFTER provider acceptance')
  }
  assert.equal(method,'GET')
  let data
  if(path==='/v3/me') data={account_id:shopId,test:true,status:'enabled'}
  else if(path===`/v3/payments/${operation.paymentId}`){
   const refunded=operation.expectedRefundedMinor+(accepted.length?operation.amountMinor:0)
   data={id:operation.paymentId,test:true,status:'succeeded',paid:true,
    recipient:{account_id:shopId},amount:item.amount,
    refunded_amount:{value:(refunded/100).toFixed(2),currency:'RUB'},
    refundable:!accepted.length,receipt_registration:'succeeded'}
   if(accepted.length) trace.push('GET_observes_accepted_refund')
  } else if(path==='/v3/receipts'&&!accepted.length) data={items:[{
   id:receiptId,type:'payment',payment_id:operation.paymentId,status:'succeeded',
   items:[{...item,quantity:'1.000000',payment_mode:'full_prepayment'}],
  }]}
  else throw Error('Unexpected synthetic provider route')
  return {ok:true,json:async()=>data}
 }
 const makeHandler=()=>{
  const service=createService();services.push(service)
  const rpc=async(name,args)=>{
   trace.push('rpc:'+args.p_action)
   const response=await service.rpc(name,args)
   if(args.p_action==='claim'&&response.data){
    operation=structuredClone(response.data);claims.push(structuredClone(operation))
   }
   return response
  }
  const epoch=Math.floor(Date.now()/1000)
  return createSubscriptionFiscalRefundEndpoint({enabled:true,allowedOrigins:['https://example.test'],
   auth:{getClaims:async()=>({data:{claims:{sub:actorId,role:'authenticated',aal:'aal2',exp:epoch+300,
    amr:[{method:'totp',timestamp:epoch}]}}}),getUser:async()=>({data:{user:{id:actorId}}})},
   service:{rpc},providerConfig:{enabled:true,shopId,secretKey:'synthetic'},transport:{fetchImpl:onSuppressed?observeLossBoundary(fetchImpl,onSuppressed):fetchImpl}})
 }
 const request=()=>new Request('https://example.test',{method:'POST',headers:{
  authorization:'Bearer synthetic',origin:'https://example.test'},body:JSON.stringify({action:'execute',commandId})})
 const unknown={state:'sending',operationState:'unknown',requiresReview:false,accessEffect:'not_applied'}
 const checkUnknown=body=>{for(const [key,value] of Object.entries(unknown))assert.equal(body[key],value,key)}
 try {
  const first=await makeHandler()(request())
  assert.equal(first.status,200) // HTTP status is readable; financial completion remains unknown.
  checkUnknown(await first.json())
  assert.equal(accepted.length,1);assert.equal(posts.length,1)
  assert.equal(claims[0].action,'send');assert.equal(claims[0].kind,'refund_before')
  assert.equal(claims[0].expectedRefundedMinor,0);assert.deepEqual(claims[0].priorReceipts,[])
  assert.equal(claims[0].commandId,commandId)
  assert.deepEqual(trace.slice(-4),['POST /v3/refunds','provider_accepted','response_lost','rpc:status'])
  assert.equal(trace.includes('rpc:record'),false);assert.equal(trace.includes('rpc:review'),false)
  afterLoss=await snapshot()
  const boundary=trace.length
  // Recreate endpoint, auth and service adapter. DB runner uses new psql for every RPC.
  const second=await makeHandler()(request())
  assert.notEqual(services[0],services[1])
  assert.equal(second.status,200);checkUnknown(await second.json())
  assert.equal(claims.length,2);assert.equal(claims[1].action,'reconcile')
  for(const key of ['commandId','key','sha256','firstSentAt','body','amountMinor','paymentId'])
   assert.deepEqual(claims[1][key],claims[0][key],key+' immutable across retry')
  assert.equal(claims[1].refundId,null)
  assert.deepEqual(trace.slice(boundary),['rpc:status','rpc:claim','GET /v3/me',
   `GET /v3/payments/${operation.paymentId}`,'GET_observes_accepted_refund','rpc:status'])
  assert.equal(accepted.length,1);assert.equal(posts.length,1)
  assert.deepEqual(await snapshot(),afterLoss,'retry leaves committed rows unchanged')
  assert.equal(networkCalls,0)
  return {before,afterLoss,claims,trace,acceptedCount:accepted.length,postCount:posts.length}
 } finally {globalThis.fetch=rawFetch}
}
