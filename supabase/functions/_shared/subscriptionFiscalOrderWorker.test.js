// @vitest-environment node
import {test,expect,vi} from 'vitest'
import {runSubscriptionFiscalOrderWorker as run,createSubscriptionFiscalOrderRuntime as runtime} from './subscriptionFiscalOrderWorker.js'
const target='11111111-1111-4111-8111-111111111111',command='22222222-2222-4222-8222-222222222222',token='a'.repeat(64)
const post=(body='{}',supplied=token)=>new Request('https://example.test',{method:'POST',headers:{'x-qvesta-worker-token':supplied,'x-qvesta-order-id':target,'x-qvesta-fiscal-mode':'reconcile'},body})
test('invalid target stops before any RPC',async()=>{const rpc=vi.fn();await expect(run({targetOrderId:'',rpc})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled()})
test('target is sent to SQL before pagination and unrelated items stop provider construction',async()=>{
 const rpc=vi.fn(async()=>({data:[{commandId:command,shopId:'123',orderId:command}]})),createProvider=vi.fn()
 await expect(run({targetOrderId:target,rpc,createProvider,shopId:'123',reconciliationEnabled:true})).rejects.toThrow('invalid_fiscal_worker_target')
 expect(rpc).toHaveBeenCalledWith('list_subscription_fiscal_order_work',{p_shop_id:'123',p_kind:'reconcile',p_limit:25,p_target_order_id:target});expect(createProvider).not.toHaveBeenCalled()
})
test('reconciliation, recording and polling all use scoped gateway',async()=>{
 const rpc=vi.fn(async(name,a)=>{
  if(name==='list_subscription_fiscal_order_work')return {data:[{commandId:command,shopId:'123',orderId:target}]}
  if(a.p_action==='read')return {data:{action:'reconcile',commandId:command,orderId:target,shopId:'123',kind:'settlement'}}
  if(a.p_action==='record')return {data:{state:'succeeded'}}
  if(a.p_action==='poll')return {data:{recorded:true}}
 })
 const provider={readFiscalOperation:vi.fn(async()=>({commandId:command,shopId:'123',state:'succeeded'})),createFiscalOperation:vi.fn()}
 expect(await run({targetOrderId:target,rpc,createProvider:()=>provider,shopId:'123',reconciliationEnabled:true})).toEqual({checked:1,failed:0,unresolved:0,dispatched:0})
 expect(rpc.mock.calls.every(([,a])=>a.p_target_order_id===target)).toBe(true);expect(provider.createFiscalOperation).not.toHaveBeenCalled()
})
test.each([{}, {YOOKASSA_SANDBOX_ENABLED:'true'}, {YOOKASSA_SANDBOX_ENABLED:'true',YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED:'true',YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ORDER_ID:'bad'}])('disabled or invalid configuration creates no clients',async env=>{
 const create=vi.fn();const handler=runtime(n=>n==='YOOKASSA_SANDBOX_WORKER_TOKEN'?token:env[n],create)
 expect((await handler(post())).status).toBe(503);expect(create).not.toHaveBeenCalled()
})
test('fixed target ignores request body target and does not invoke any legacy batch',async()=>{
 const env={YOOKASSA_SANDBOX_ENABLED:'true',YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED:'true',YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ORDER_ID:target,YOOKASSA_SANDBOX_WORKER_TOKEN:token,SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic',YOOKASSA_SANDBOX_SHOP_ID:'123',YOOKASSA_SANDBOX_SECRET_KEY:'synthetic'}
 const rpc=vi.fn(async()=>({data:[]})),create=vi.fn(()=>({rpc})),provider=vi.fn(()=>({}))
 const handler=runtime(n=>env[n],create,provider)
 expect((await handler(post('{}','b'.repeat(64)))).status).toBe(401);expect(create).not.toHaveBeenCalled()
 const r=await handler(post(JSON.stringify({orderId:command,dispatch:true})));expect(r.status).toBe(200)
 expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][0]).toBe('list_subscription_fiscal_order_work');expect(rpc.mock.calls[0][1].p_target_order_id).toBe(target)
})
test('dispatch keeps claim, before-send and result inside the same target',async()=>{
 const claim={action:'send',kind:'settlement',commandId:command,orderId:target,shopId:'123',key:'saved-key',sha256:'saved-hash'}
 const rpc=vi.fn(async(name,a)=>{
  if(name==='list_subscription_fiscal_order_work')return {data:a.p_kind==='due'?[{orderId:target,shopId:'123'}]:[]}
  if(a.p_action==='claim_settlement')return {data:claim}
  if(a.p_action==='before_send')return {data:{authorized:true,commandId:command,key:claim.key,sha256:claim.sha256}}
  if(a.p_action==='record')return {data:{state:'succeeded'}}
  if(a.p_action==='poll')return {data:{recorded:true}}
 })
 const createProvider=options=>({createFiscalOperation:async operation=>{await options.beforeFiscalSend(operation);return {commandId:command,shopId:'123',state:'succeeded'}}})
 expect((await run({targetOrderId:target,rpc,createProvider,shopId:'123',reconciliationEnabled:true,dispatchEnabled:true})).dispatched).toBe(1)
 expect(rpc.mock.calls.every(([,a])=>a.p_target_order_id===target)).toBe(true)
 expect(rpc.mock.calls.filter(([,a])=>a.p_action==='before_send')).toHaveLength(1)
})

test.each([{}, {'x-qvesta-order-id':command,'x-qvesta-fiscal-mode':'reconcile'}, {'x-qvesta-order-id':target,'x-qvesta-fiscal-mode':'dispatch'}])('stale target or dispatch configuration fails before clients %j',headers=>{
 const env={YOOKASSA_SANDBOX_ENABLED:'true',YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED:'true',YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ORDER_ID:target,YOOKASSA_SANDBOX_WORKER_TOKEN:token}
 const create=vi.fn(),handler=runtime(n=>env[n],create)
 return handler(new Request('https://example.test',{method:'POST',headers:{'x-qvesta-worker-token':token,...headers}})).then(r=>{expect(r.status).toBe(503);expect(create).not.toHaveBeenCalled()})
})
