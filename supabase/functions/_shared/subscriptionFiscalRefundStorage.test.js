// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createSubscriptionFiscalRefundStorage } from './subscriptionFiscalRefundStorage.js'
import { runSubscriptionFiscalOperation } from './subscriptionFiscalFlow.js'
const commandId='11111111-1111-4111-8111-111111111111'
const actorId='22222222-2222-4222-8222-222222222222'
const identity={actorId,aal:'aal2',mfaAt:100,expiresAt:400}
const context={identity,shopId:'123',commandId}
const result={commandId,shopId:'123',paymentId:actorId,bodySha256:'a'.repeat(64),amountMinor:100,state:'succeeded',refundId:actorId,receiptId:null,receiptStatus:'unknown'}
describe('trusted fiscal refund storage',()=>{
 it('copies verified identity and fixes the operation scope',async()=>{
  const mutable={...identity};const rpc=vi.fn().mockResolvedValue({data:{action:'review'}})
  const storage=createSubscriptionFiscalRefundStorage({...context,identity:mutable,rpc})
  mutable.actorId=commandId
  await storage.claim(commandId)
  expect(rpc).toHaveBeenCalledWith('subscription_fiscal_refund_from_gateway',expect.objectContaining({p_actor_user_id:actorId,p_shop_id:'123',p_command_id:commandId,p_action:'claim'}))
  await expect(storage.claim(actorId)).rejects.toThrow('invalid_fiscal_storage_command')
  expect(rpc).toHaveBeenCalledTimes(1)
 })
 it('passes only verified result fields and retains safe access outcome',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{state:'succeeded',receiptStatus:'unknown',accessState:'applied',body:{secret:'not exposed'}}})
  const storage=createSubscriptionFiscalRefundStorage({...context,rpc})
  expect(await storage.record({...result,email:'synthetic@example.test',rawProvider:{}})).toBe('succeeded')
  expect(rpc.mock.calls[0][1].p_result).toEqual(result)
  expect(storage.result()).toEqual({state:'succeeded',receiptStatus:'unknown',accessState:'applied'})
  const copy=storage.result();copy.accessState='wrong';expect(storage.result().accessState).toBe('applied')
 })
 it('rejects cross-shop results before RPC',async()=>{
  const rpc=vi.fn();const storage=createSubscriptionFiscalRefundStorage({...context,rpc})
  await expect(storage.record({...result,shopId:'456'})).rejects.toThrow('invalid_fiscal_storage_shop');expect(rpc).not.toHaveBeenCalled()
 })
 it.each([{error:{message:'private detail'}},{data:null}])('sanitizes storage errors %#',async response=>{
  const storage=createSubscriptionFiscalRefundStorage({...context,rpc:async()=>response})
  await expect(storage.claim(commandId)).rejects.toThrow('fiscal_storage_unavailable')
 })
 it.each([{state:'succeeded'},{state:'unknown',accessState:'applied'}])('does not claim incomplete storage success %#',async data=>{
  const storage=createSubscriptionFiscalRefundStorage({...context,rpc:async()=>({data})})
  await expect(storage.record(result)).rejects.toThrow('fiscal_storage_unconfirmed');expect(storage.result()).toBeNull()
 })
 it('requires persisted review acknowledgement',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({data:{state:'review'}}).mockResolvedValueOnce({data:{state:'pending'}})
  const storage=createSubscriptionFiscalRefundStorage({...context,rpc})
  await storage.markReview(commandId,'provider_mismatch')
  await expect(storage.markReview(commandId,'unidentified_refund')).rejects.toThrow('fiscal_storage_unconfirmed')
  await expect(storage.markReview(commandId,'raw error')).rejects.toThrow('invalid_fiscal_review_reason')
  expect(rpc).toHaveBeenCalledTimes(2)
 })
 it('integrates claim, provider verification, record and access outcome',async()=>{
  const claim={...result,action:'send',kind:'refund_before',sha256:result.bodySha256}
  const rpc=vi.fn().mockResolvedValueOnce({data:claim}).mockResolvedValueOnce({data:{state:'succeeded',receiptStatus:'unknown',accessState:'review_required'}})
  const storage=createSubscriptionFiscalRefundStorage({...context,rpc})
  const provider={createFiscalOperation:vi.fn().mockResolvedValue(result)}
  expect(await runSubscriptionFiscalOperation({enabled:true,commandId,shopId:'123',storage,provider})).toEqual({state:'succeeded',receiptStatus:'unknown'})
  expect(storage.result().accessState).toBe('review_required')
  expect(provider.createFiscalOperation).toHaveBeenCalledTimes(1)
 })
 it('disabled flow does not claim or call a provider',async()=>{
  const rpc=vi.fn();const storage=createSubscriptionFiscalRefundStorage({...context,rpc})
  expect(await runSubscriptionFiscalOperation({commandId,shopId:'123',storage})).toEqual({state:'disabled'})
  expect(rpc).not.toHaveBeenCalled()
 })
 it('rejects unverified context',()=>{
  expect(()=>createSubscriptionFiscalRefundStorage({...context,identity:{...identity,aal:'aal1'},rpc:vi.fn()})).toThrow('invalid_fiscal_storage_context')
 })
})
