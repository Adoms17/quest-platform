// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {runSubscriptionFiscalWorker as run} from './subscriptionFiscalWorker.js'
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
function setup(){
 const claim={action:'send',kind:'settlement',commandId:id(1),orderId:id(2),shopId:'123',paymentId:id(3),amountMinor:100,sha256:'a'.repeat(64)}
 const result={commandId:id(1),shopId:'123',paymentId:id(3),amountMinor:100,bodySha256:claim.sha256,state:'succeeded',receiptStatus:'succeeded'}
 const provider={createFiscalOperation:vi.fn(async()=>result),readFiscalOperation:vi.fn(async()=>result)}
 const rpc=vi.fn(async(name,args)=>{
  if(name==='list_subscription_fiscal_work')return {data:args.p_kind==='due'?[{orderId:id(2),shopId:'123'}]:[]}
  if(args.p_action==='claim_settlement')return {data:claim}
  if(args.p_action==='record')return {data:{state:'succeeded'}}
  if(args.p_action==='poll')return {data:{recorded:true}}
  if(args.p_action==='read')return {data:{...claim,action:'reconcile'}}
  if(args.p_action==='review')return {data:{state:'review'}}
  if(args.p_action==='before_send')return {data:{authorized:true,commandId:id(1),key:'key',sha256:claim.sha256}}
 })
 const createProvider=vi.fn(()=>provider),args={reconciliationEnabled:true,dispatchEnabled:true,rpc,shopId:'123',createProvider}
 return {claim,result,provider,rpc,createProvider,args}
}
it('disabled does not read, construct a provider or dispatch',async()=>{const s=setup();expect(await run({...s.args,reconciliationEnabled:false})).toEqual({checked:0,failed:0,unresolved:0,dispatched:0});expect(s.rpc).not.toHaveBeenCalled();expect(s.createProvider).not.toHaveBeenCalled()})
it('dispatch flag alone cannot enable sending',async()=>{const s=setup();await run({...s.args,reconciliationEnabled:undefined});expect(s.rpc).not.toHaveBeenCalled()})
it('settlement uses one create and records poll outcome',async()=>{const s=setup();expect(await run(s.args)).toEqual({checked:1,failed:0,unresolved:0,dispatched:1});expect(s.provider.createFiscalOperation).toHaveBeenCalledTimes(1);expect(s.rpc).toHaveBeenCalledWith('subscription_fiscal_worker_gateway',expect.objectContaining({p_action:'poll',p_result:{resolved:true}}))})
it('reconcile mode never claims settlement or creates anything',async()=>{const s=setup(),rpc=s.rpc.getMockImplementation();s.rpc.mockImplementation((n,a)=>n==='list_subscription_fiscal_work'?{data:[{commandId:id(1),shopId:'123'}]}:rpc(n,a));await run({...s.args,dispatchEnabled:false});expect(s.provider.createFiscalOperation).not.toHaveBeenCalled();expect(s.provider.readFiscalOperation).toHaveBeenCalledTimes(1);expect(s.rpc.mock.calls.some(([,a])=>a.p_action==='claim_settlement')).toBe(false)})
it('a repeated claim reconciles rather than sending',async()=>{const s=setup();s.claim.action='reconcile';await run(s.args);expect(s.provider.createFiscalOperation).not.toHaveBeenCalled();expect(s.provider.readFiscalOperation).toHaveBeenCalledTimes(1)})
it('worker rejects an attempted refund POST',async()=>{const s=setup();s.claim.kind='refund_before';expect((await run(s.args)).failed).toBe(1);expect(s.provider.createFiscalOperation).not.toHaveBeenCalled()})
it('validates foreign or duplicate batch before provider calls',async()=>{const s=setup();s.rpc.mockResolvedValue({data:[{commandId:id(1),shopId:'456'}]});await expect(run(s.args)).rejects.toThrow('invalid_fiscal_batch');expect(s.createProvider).not.toHaveBeenCalled()})
it('unknown provider result preserves work and schedules backoff',async()=>{const s=setup();s.provider.createFiscalOperation.mockRejectedValue(Error('timeout'));expect((await run(s.args)).unresolved).toBe(1);expect(s.rpc.mock.calls.find(([,a])=>a.p_action==='poll')[1].p_result).toEqual({resolved:false});expect(s.rpc.mock.calls.some(([,a])=>a.p_action==='record')).toBe(false)})
it('failed poll persistence fails the batch rather than hiding a tight loop',async()=>{const s=setup(),rpc=s.rpc.getMockImplementation();s.rpc.mockImplementation((n,a)=>a.p_action==='poll'?{error:{}}:rpc(n,a));await expect(run(s.args)).rejects.toThrow('fiscal_worker_storage_unavailable')})
it('before-send callback requires exact confirmed authorization',async()=>{const s=setup();await run(s.args);const hook=s.createProvider.mock.calls[0][0].beforeFiscalSend;await hook({commandId:id(1),key:'key',sha256:s.claim.sha256});s.rpc.mockResolvedValue({data:{authorized:false}});await expect(hook({commandId:id(1),key:'key',sha256:s.claim.sha256})).rejects.toThrow('fiscal_worker_send_denied')})
it('access review remains unresolved and uses failure backoff',async()=>{const s=setup(),rpc=s.rpc.getMockImplementation();s.rpc.mockImplementation((n,a)=>a.p_action==='record'?{data:{state:'succeeded',accessState:'review_required'}}:rpc(n,a));expect((await run(s.args)).unresolved).toBe(1);expect(s.rpc.mock.calls.find(([,a])=>a.p_action==='poll')[1].p_result).toEqual({resolved:false})})
