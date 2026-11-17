// @vitest-environment node
import {it,expect,vi,describe,beforeEach,afterEach} from 'vitest'
import {createSubscriptionFiscalRefundEndpoint} from './subscriptionFiscalRefundEndpoint.js'
import {createSubscriptionFiscalRefundRuntime} from './subscriptionFiscalRefundRuntime.js'
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
function setup(){
 const epoch=Math.floor(Date.now()/1000)
 const auth={getClaims:vi.fn(async()=>({data:{claims:{sub:id(1),role:'authenticated',aal:'aal2',exp:epoch+600,amr:[{method:'totp',timestamp:epoch}]}}})),getUser:vi.fn(async()=>({data:{user:{id:id(1)}}}))}
 const item={description:'Subscription',quantity:'1.000000',amount:{value:'10.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}
 const operation={commandId:id(2),paymentId:id(4),shopId:'123',key:id(5),sha256:'a'.repeat(64),kind:'refund_before',amountMinor:1000,expectedRefundedMinor:0,firstSentAt:new Date().toISOString(),priorReceipts:[],refundId:null,receiptId:null,
 body:{payment_id:id(4),amount:{value:'10.00',currency:'RUB'},receipt:{customer:{email:'synthetic@example.test'},items:[item]}}}
 const current={commandId:id(2),refundId:id(3),state:'reserved',operationState:'reserved',receiptStatus:null,requiresReview:false,accessEffect:'not_applied',environment:'sandbox'}
 let claimed=false,paidBack=false
 const service={rpc:vi.fn(async(name,args)=>{
  if(name==='prepare_linked_fiscal_refund_from_gateway')return {data:{requestId:id(2),commandId:id(2),refundId:id(3)}}
  if(args.p_action==='status')return {data:{...current,body:'should not leak'}}
  if(args.p_action==='claim'){const action=claimed?'reconcile':'send';claimed=true;if(current.state==='reserved'){current.state='sending';current.operationState='unknown'}return {data:{...operation,action}}}
  if(args.p_action==='before_send')return {data:{authorized:true,commandId:id(2),key:operation.key,sha256:operation.sha256}}
  if(args.p_action==='record'){operation.refundId=args.p_result.refundId;operation.receiptId=args.p_result.receiptId;current.state=args.p_result.state;current.operationState=current.state;current.receiptStatus=args.p_result.receiptStatus;current.accessEffect='applied';return {data:{state:current.state,receiptStatus:current.receiptStatus,accessState:'applied'}}}
  if(args.p_action==='review'){current.requiresReview=true;return {data:{state:'review'}}}
  throw Error('unexpected RPC')
 })}
 const original={id:'ra-'+id(7),type:'payment',payment_id:id(4),status:'succeeded',items:[item]}
 const receipt={id:'ra-'+id(8),type:'refund',payment_id:id(4),refund_id:id(6),status:'succeeded',items:[item]}
 const refund={id:id(6),payment_id:id(4),status:'succeeded',amount:{value:'10.00',currency:'RUB'}}
 const fetchImpl=vi.fn(async(url,options)=>{
  let value
  if(options.method==='POST'){paidBack=true;value=refund}
  else if(url.endsWith('/me'))value={account_id:'123',test:true,status:'enabled'}
  else if(url.includes('/payments/'))value={id:id(4),test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:{value:'10.00',currency:'RUB'},refunded_amount:{value:paidBack?'10.00':'0.00',currency:'RUB'},refundable:!paidBack,receipt_registration:'succeeded'}
  else if(url.includes('/refunds/'))value=refund
  else if(url.includes('/receipts/'))value=receipt
  else value={items:new URL(url).searchParams.get('refund_id')===id(6)?(paidBack?[receipt]:[]):[original]}
  return {ok:true,json:async()=>value}
 })
 const options={enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],auth,service,providerConfig:{enabled:true,shopId:'123',secretKey:'synthetic'},transport:{fetchImpl}}
 const handler=createSubscriptionFiscalRefundEndpoint(options)
 const request=(body={action:'execute',commandId:id(2)},headers={})=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://stage-admin.qvesta.ru',...headers},body:JSON.stringify(body)})
 return {auth,service,fetchImpl,handler,request,options,current,operation,posts:()=>fetchImpl.mock.calls.filter(([,o])=>o.method==='POST')}
}
it('requires fresh authorization after GETs, persists money, then confirms receipt by GET only',async()=>{
 const s=setup();let before=false
 const rpc=s.service.rpc.getMockImplementation(),fetch=s.fetchImpl.getMockImplementation()
 s.service.rpc.mockImplementation((name,args)=>{if(args.p_action==='before_send')before=true;return rpc(name,args)})
 s.fetchImpl.mockImplementation((url,options)=>{if(options.method==='POST')expect(before).toBe(true);return fetch(url,options)})
 let response=await s.handler(s.request());expect(response.status).toBe(200)
 const first=await response.json();expect(first).toMatchObject({state:'succeeded',receiptStatus:'unknown',accessEffect:'applied'})
 expect(first).not.toHaveProperty('body');expect(s.auth.getClaims).toHaveBeenCalledTimes(2)
 response=await s.handler(s.request());expect(await response.json()).toMatchObject({state:'succeeded',receiptStatus:'succeeded',accessEffect:'applied'})
 expect(s.posts()).toHaveLength(1)
})
it('a concurrent check without provider ID cannot mark an in-flight send for review',async()=>{
 const s=setup(),fetch=s.fetchImpl.getMockImplementation();let started,release
 const ready=new Promise(resolve=>{started=resolve}),gate=new Promise(resolve=>{release=resolve})
 s.fetchImpl.mockImplementation(async(url,options)=>{if(options.method==='POST'){started();await gate}return fetch(url,options)})
 const first=s.handler(s.request());await ready
 const second=await s.handler(s.request());expect(await second.json()).toMatchObject({state:'sending',requiresReview:false})
 expect(s.service.rpc.mock.calls.some(([,a])=>a.p_action==='review')).toBe(false)
 release();expect(await (await first).json()).toMatchObject({state:'succeeded'});expect(s.posts()).toHaveLength(1)
})
describe('final pre-send refusal after a successful in-memory claim and GETs',()=>{
 const epoch=1800000000
 const authFailures=['expired','stale','claims-error','claims-throw','user-error','user-throw','user-mismatch','actor-change']
 const sqlFailures=['unauthorized','non-boolean-authorization','command','key','hash','null-data','empty-data','sql-error','rejection','throw']
 let network
 beforeEach(()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(epoch*1000)
  // Do not let a missing injected transport silently fall back to real fetch.
  network=vi.fn(()=>{throw Error('network forbidden in final-send tests')})
  vi.stubGlobal('fetch',network)
 })
 afterEach(()=>{
  try{expect(network).not.toHaveBeenCalled()}
  finally{vi.unstubAllGlobals();vi.useRealTimers()}
 })
 function deniedSend(layer,failure,finalStatus){
  const s=setup(),events=[],claimActions=[]
  const initialOperation=structuredClone(s.operation)
  const initialContext={p_actor_user_id:id(1),p_mfa_at:epoch,p_expires_at:epoch+600,p_shop_id:'123',p_command_id:id(2)}
  const rpc=s.service.rpc.getMockImplementation(),fetch=s.fetchImpl.getMockImplementation()
  let afterGets=false,retrying=false,statusReads=0
  const finalAuth=()=>afterGets&&!retrying
  s.auth.getClaims.mockImplementation(async()=>{
   events.push('auth:claims')
   const claims={sub:id(1),role:'authenticated',aal:'aal2',exp:epoch+600,amr:[{method:'totp',timestamp:epoch}]}
   if(finalAuth()&&layer==='auth'){
    if(failure==='claims-error')return {error:{code:'synthetic'}}
    if(failure==='claims-throw')throw Error('synthetic claims failure')
    // Change one condition only, at the exact rejection boundary.
    if(failure==='expired')claims.exp=epoch
    if(failure==='stale')claims.amr[0].timestamp=epoch-300
    if(failure==='actor-change')claims.sub=id(9)
   }
   if(finalAuth()&&layer==='sql'){
    // Both identities are valid, but RPCs must retain the initial frozen context.
    claims.exp=epoch+900;claims.amr[0].timestamp=epoch-1
   }
   return {data:{claims}}
  })
  s.auth.getUser.mockImplementation(async()=>{
   events.push('auth:user')
   if(finalAuth()&&layer==='auth'){
    if(failure==='user-error')return {error:{code:'synthetic'}}
    if(failure==='user-throw')throw Error('synthetic user failure')
    // actor-change updates both SDK identities, reaching actor continuity check.
    if(['user-mismatch','actor-change'].includes(failure))return {data:{user:{id:id(9)}}}
   }
   return {data:{user:{id:id(1)}}}
  })
  s.fetchImpl.mockImplementation(async(url,options)=>{
   const path=new URL(url).pathname
   if(options.method!=='GET'||!['/v3/me','/v3/payments/'+id(4),'/v3/receipts'].includes(path)){
    throw Error('unexpected fake provider request')
   }
   const response=await fetch(url,options)
   return {...response,json:async()=>{
    const body=await response.json()
    events.push('get:ok:'+path)
    if(path==='/v3/receipts')afterGets=true
    return body
   }}
  })
  s.service.rpc.mockImplementation((name,args)=>{
   const action=args.p_action
   events.push('rpc:'+action)
   if(action==='status'&&++statusReads===2){
    if(finalStatus==='error')return Promise.resolve({error:{code:'42501'}})
    if(finalStatus==='invalid')return Promise.resolve({data:{...s.current,commandId:id(9)}})
   }
   if(action==='before_send'){
    if(failure==='throw')throw Error('synthetic synchronous RPC failure')
    if(failure==='rejection')return Promise.reject(Error('synthetic RPC rejection'))
    if(failure==='sql-error')return Promise.resolve({error:{code:'42501'}})
    if(failure==='null-data')return Promise.resolve({data:null})
    if(failure==='empty-data')return Promise.resolve({data:{}})
    const data={authorized:true,commandId:id(2),key:initialOperation.key,sha256:initialOperation.sha256}
    if(failure==='unauthorized')data.authorized=false
    if(failure==='non-boolean-authorization')data.authorized='true'
    if(failure==='command')data.commandId=id(9)
    if(failure==='key')data.key=id(9)
    if(failure==='hash')data.sha256='b'.repeat(64)
    return Promise.resolve({data})
   }
   return Promise.resolve(rpc(name,args)).then(result=>{
    if(action==='claim'){claimActions.push(result.data.action);events.push('claim:'+result.data.action)}
    return result
   })
  })
  return {...s,events,claimActions,initialOperation,initialContext,restoreAuth:()=>{retrying=true}}
 }
 async function assertDenialAndRetry(layer,failure,finalStatus){
  const s=deniedSend(layer,failure,finalStatus)
  const response=await s.handler(s.request())
  expect(response.status).toBe(finalStatus==='readable'?200:503)
  const unchangedMoney={commandId:id(2),refundId:id(3),state:'sending',operationState:'unknown',receiptStatus:null,requiresReview:false,accessEffect:'not_applied',environment:'sandbox'}
  expect(await response.json()).toEqual(finalStatus==='readable'?unchangedMoney:{error:'fiscal_refund_unconfirmed',commandId:id(2)})
  const finalUser=layer==='sql'||['user-error','user-throw','user-mismatch','actor-change'].includes(failure)
  expect(s.events).toEqual([
   'auth:claims','auth:user','rpc:status','rpc:claim','claim:send',
   'get:ok:/v3/me','get:ok:/v3/payments/'+id(4),'get:ok:/v3/receipts',
   'auth:claims',...(finalUser?['auth:user']:[]),...(layer==='sql'?['rpc:before_send']:[]),'rpc:status',
  ])
  expect(s.claimActions).toEqual(['send'])
  expect(s.current).toEqual(unchangedMoney)
  expect(s.operation).toEqual(s.initialOperation)
  expect(s.posts()).toHaveLength(0)
  const actions=()=>s.service.rpc.mock.calls.map(([,args])=>args.p_action)
  expect(actions().filter(action=>action==='before_send')).toHaveLength(layer==='sql'?1:0)
  expect(actions().some(action=>['record','review'].includes(action))).toBe(false)
  // A refusal before the very first POST consumes the fake claim too. This is
  // distinct from lost-response recovery after an already attempted POST.
  s.restoreAuth();const start=s.events.length
  const retry=await s.handler(s.request())
  expect(retry.status).toBe(200);expect(await retry.json()).toEqual(unchangedMoney)
  expect(s.events.slice(start)).toEqual([
   'auth:claims','auth:user','rpc:status','rpc:claim','claim:reconcile',
   'get:ok:/v3/me','get:ok:/v3/payments/'+id(4),'rpc:status',
  ])
  expect(s.claimActions).toEqual(['send','reconcile'])
  expect(s.current).toEqual(unchangedMoney);expect(s.operation).toEqual(s.initialOperation)
  expect(s.posts()).toHaveLength(0)
  expect(actions().filter(action=>action==='before_send')).toHaveLength(layer==='sql'?1:0)
  expect(actions().some(action=>['record','review'].includes(action))).toBe(false)
  // Assert outside the handler: an assertion thrown inside its RPC callback
  // could be swallowed as the very refusal this test expects.
  for(const [name,args] of s.service.rpc.mock.calls){
   expect(name).toBe('subscription_fiscal_refund_from_gateway')
   expect(args).toMatchObject(s.initialContext)
   if(args.p_action==='before_send')expect(args.p_result).toEqual({key:s.initialOperation.key,sha256:s.initialOperation.sha256,firstSentAt:s.initialOperation.firstSentAt})
  }
 }
 for(const finalStatus of ['readable','error','invalid']){
  it.each(authFailures)(`Auth %s refusal, final status ${finalStatus}, then restored-auth retry never sends`,async failure=>{
   await assertDenialAndRetry('auth',failure,finalStatus)
  })
  it.each(sqlFailures)(`SQL %s refusal, final status ${finalStatus}, then retry never sends`,async failure=>{
   await assertDenialAndRetry('sql',failure,finalStatus)
  })
 }
})
it('lost POST response stays unknown and a retry never sends again',async()=>{
 const s=setup(),fetch=s.fetchImpl.getMockImplementation(),log=vi.spyOn(console,'error').mockImplementation(()=>{})
 try{s.fetchImpl.mockImplementation((url,options)=>{if(options.method==='POST')throw Error('timeout');return fetch(url,options)})
  expect(await (await s.handler(s.request())).json()).toMatchObject({state:'sending',operationState:'unknown'})
  await s.handler(s.request());expect(s.posts()).toHaveLength(1)
 }finally{log.mockRestore()}
})
it('storage failure after provider success is not reported as completion',async()=>{
 const s=setup(),rpc=s.service.rpc.getMockImplementation()
 s.service.rpc.mockImplementation((n,a)=>a.p_action==='record'?{error:{code:'XX000'}}:rpc(n,a))
 expect((await s.handler(s.request())).status).toBe(503)
 await s.handler(s.request());expect(s.posts()).toHaveLength(1)
})
it('provider accepts before response loss; a new handler observes the effect but never resends',async()=>{
 const s=setup(),fetch=s.fetchImpl.getMockImplementation(),rpc=s.service.rpc.getMockImplementation()
 const events=[],claims=[];let accepted=0
 const log=vi.spyOn(console,'error').mockImplementation(()=>{})
 const network=vi.fn(()=>{throw Error('real network forbidden')})
 vi.stubGlobal('fetch',network)
 try{
  s.service.rpc.mockImplementation(async(name,args)=>{
   const result=await rpc(name,args)
   if(args.p_action==='claim')claims.push(structuredClone(result.data))
   return result
  })
  s.fetchImpl.mockImplementation(async(url,options)=>{
   const response=await fetch(url,options) // Fake provider commits paidBack before the throw.
   if(options.method==='POST'){
    const result=await response.json()
    expect(result.status).toBe('succeeded');accepted++;events.push('accepted','response_lost')
    throw Error('synthetic lost response after acceptance')
   }
   if(url.includes('/payments/'))events.push((await response.json()).refunded_amount.value)
   return response
  })
  const immutable=structuredClone(s.operation)
  expect(await (await s.handler(s.request())).json()).toMatchObject({state:'sending',operationState:'unknown',accessEffect:'not_applied'})
  expect(accepted).toBe(1);expect(events).toEqual(['0.00','accepted','response_lost'])
  const afterLoss=structuredClone(s.current),boundary=s.fetchImpl.mock.calls.length
  const retry=createSubscriptionFiscalRefundEndpoint({...s.options,service:{rpc:s.service.rpc},transport:{fetchImpl:s.fetchImpl}})
  expect(retry).not.toBe(s.handler)
  expect(await (await retry(s.request())).json()).toMatchObject({state:'sending',operationState:'unknown',accessEffect:'not_applied',requiresReview:false})
  expect(events).toEqual(['0.00','accepted','response_lost','10.00'])
  expect(accepted).toBe(1);expect(s.posts()).toHaveLength(1)
  expect(s.fetchImpl.mock.calls.slice(boundary).map(([,options])=>options.method)).toEqual(['GET','GET'])
  expect(claims.map(c=>c.action)).toEqual(['send','reconcile'])
  expect(claims[1]).toEqual({...claims[0],action:'reconcile'})
  expect(s.operation).toEqual(immutable);expect(s.current).toEqual(afterLoss)
  expect(s.service.rpc.mock.calls.some(([,args])=>['record','review'].includes(args.p_action))).toBe(false)
  expect(network).not.toHaveBeenCalled()
 }finally{log.mockRestore();vi.unstubAllGlobals()}
})
it('scope denial stops before provider calls',async()=>{
 const s=setup();s.service.rpc.mockResolvedValue({error:{code:'42501'}})
 expect((await s.handler(s.request())).status).toBe(403);expect(s.fetchImpl).not.toHaveBeenCalled()
})
it.each([{action:'execute',commandId:id(2),amountMinor:1},{action:'execute',commandId:id(2),actorId:id(9)}, {action:'record',commandId:id(2)}, {action:'execute',commandId:'bad'}])('rejects client controlled context %j',async body=>{
 const s=setup();expect((await s.handler(s.request(body))).status).toBe(400);expect(s.service.rpc).not.toHaveBeenCalled()
})
it('reservation sends only verified identity, fixed shop and exact request',async()=>{
 const s=setup(),response=await s.handler(s.request({action:'reserve',organizationId:id(9),orderId:id(10),requestId:id(2)}))
 expect(await response.json()).toEqual({request_id:id(2),refund_id:id(3),fiscal_command_id:id(2)})
 expect(s.fetchImpl).not.toHaveBeenCalled();expect(s.service.rpc).toHaveBeenCalledWith('prepare_linked_fiscal_refund_from_gateway',expect.objectContaining({p_actor_user_id:id(1),p_shop_id:'123'}))
})
it('rejects a foreign origin and oversized body',async()=>{
 const s=setup();expect((await s.handler(s.request({}, {origin:'https://other.test'}))).status).toBe(403)
 expect((await s.handler(s.request({action:'execute',commandId:id(2),extra:'a'.repeat(1100)}))).status).toBe(400)
 expect(s.service.rpc).not.toHaveBeenCalled()
})
it.each([{}, {YOOKASSA_SANDBOX_ENABLED:'true',ADMIN_SUBSCRIPTION_REFUNDS_ENABLED:'true'}, {YOOKASSA_SANDBOX_ENABLED:'true',ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED:'true'}])('runtime stays closed without its flag and full config %j',async env=>{
 const create=vi.fn();const handler=createSubscriptionFiscalRefundRuntime(name=>env[name],create)
 const response=await handler(new Request('https://example.test',{method:'POST'}))
 expect(response.status).toBe(503);expect(create).not.toHaveBeenCalled()
})

it.each([false,true])('scoped status is read-only with dispatch enabled=%s',async enabled=>{
 const s=setup();const handler=createSubscriptionFiscalRefundEndpoint({...s.options,enabled,statusCommandId:id(2)})
 const response=await handler(s.request({action:'status',commandId:id(2)}))
 expect(response.status).toBe(200);expect(await response.json()).toEqual(s.current)
 expect(s.service.rpc).toHaveBeenCalledTimes(1)
 expect(s.service.rpc.mock.calls[0][1].p_action).toBe('status')
 expect(s.fetchImpl).not.toHaveBeenCalled()
 for(const body of [{action:'execute',commandId:id(2)},{action:'reserve',organizationId:id(9),orderId:id(10),requestId:id(2)},{action:'status',commandId:id(9)}]){
  expect((await handler(s.request(body))).status).toBe(503)
 }
 expect(s.service.rpc).toHaveBeenCalledTimes(1);expect(s.fetchImpl).not.toHaveBeenCalled()
})
it.each(['expired','stale','signature','user'])('status rejects %s identity before storage',async reason=>{
 const s=setup(),epoch=Math.floor(Date.now()/1000)
 const claims=(await s.auth.getClaims()).data.claims
 if(reason==='expired')claims.exp=epoch-1
 if(reason==='stale')claims.amr=[{method:'totp',timestamp:epoch-301}]
 s.auth.getClaims.mockResolvedValue(reason==='signature'?{error:{}}:{data:{claims}})
 if(reason==='user')s.auth.getUser.mockResolvedValue({error:{}})
 const handler=createSubscriptionFiscalRefundEndpoint({...s.options,enabled:false,statusCommandId:id(2)})
 expect((await handler(s.request({action:'status',commandId:id(2)}))).status).toBe(401)
 expect(s.service.rpc).not.toHaveBeenCalled();expect(s.fetchImpl).not.toHaveBeenCalled()
})
it('status preserves gateway role denial and does not disclose storage data',async()=>{
 const s=setup();s.service.rpc.mockResolvedValue({error:{code:'42501'}})
 const handler=createSubscriptionFiscalRefundEndpoint({...s.options,enabled:false,statusCommandId:id(2)})
 const response=await handler(s.request({action:'status',commandId:id(2)}))
 expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'refund_access_denied'})
 expect(s.fetchImpl).not.toHaveBeenCalled()
})
it('status is unavailable without a configured target',async()=>{
 const s=setup();expect((await s.handler(s.request({action:'status',commandId:id(2)}))).status).toBe(503)
 expect(s.service.rpc).not.toHaveBeenCalled()
})
it('runtime scoped status needs no provider secret and overrides financial flags',()=>{
 const env={ADMIN_SUBSCRIPTION_FISCAL_STATUS_COMMAND_ID:id(2),YOOKASSA_SANDBOX_ENABLED:'true',ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED:'true',SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic',YOOKASSA_SANDBOX_SHOP_ID:'123'}
 const read=vi.fn(key=>env[key]),create=vi.fn(()=>({auth:{}})),endpoint=vi.fn()
 createSubscriptionFiscalRefundRuntime(read,create,endpoint)
 expect(endpoint).toHaveBeenCalledWith(expect.objectContaining({enabled:false,statusCommandId:id(2),providerConfig:{enabled:false,shopId:'123',secretKey:null}}))
 expect(read).not.toHaveBeenCalledWith('YOOKASSA_SANDBOX_SECRET_KEY')
})
it('invalid status target cannot fall back to enabled financial execution',async()=>{
 const env={ADMIN_SUBSCRIPTION_FISCAL_STATUS_COMMAND_ID:'invalid',YOOKASSA_SANDBOX_ENABLED:'true',ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED:'true'}
 const create=vi.fn(),handler=createSubscriptionFiscalRefundRuntime(key=>env[key],create)
 expect((await handler(new Request('https://example.test',{method:'POST'}))).status).toBe(503)
 expect(create).not.toHaveBeenCalled()
})
