// @vitest-environment node
import {it,expect,vi} from 'vitest'
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
  else value={items:paidBack?[original,receipt]:[original]}
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
it.each(['auth','gateway'])('revoked %s after GETs blocks POST',async reason=>{
 const s=setup()
 if(reason==='auth')s.auth.getClaims.mockResolvedValueOnce(await s.auth.getClaims()).mockResolvedValue({error:{}})
 else {const rpc=s.service.rpc.getMockImplementation();s.service.rpc.mockImplementation((n,a)=>a.p_action==='before_send'?{error:{code:'42501'}}:rpc(n,a))}
 expect((await s.handler(s.request())).status).toBe(200);expect(s.posts()).toHaveLength(0);expect(s.current.state).toBe('sending')
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
