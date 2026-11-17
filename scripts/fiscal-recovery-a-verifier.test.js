// @vitest-environment node
import {test,expect} from 'vitest'
import {spawnSync} from 'node:child_process'
import {verifyRecoveryA,createRecoveryObserver,observeLossBoundary,createRecoveryReads,readRecoveryA,assertRecoveryParity} from './fiscal-recovery-a-verifier.js'
const operation={commandId:'command',shopId:'123',paymentId:'payment',amountMinor:1000,sha256:'hash',key:'key',body:{amount:{value:'10.00',currency:'RUB'}}}
function fixture(){return {operation:structuredClone(operation),evidence:{operation:structuredClone(operation),refundId:'refund'},shop:{account_id:'123',test:true},payment:{id:'payment',test:true,recipient:{account_id:'123'},status:'succeeded',paid:true},refund:{id:'refund',payment_id:'payment',status:'succeeded',amount:{value:'10.00',currency:'RUB'}}}}
test('verifies only matching immutable provenance and provider identity',()=>expect(verifyRecoveryA(fixture())).toMatchObject({state:'succeeded',amountMinor:1000,refundId:'refund'}))
test.each([
 ['shop','test',false],['shop','account_id','other'],['payment','id','other'],['payment','test',false],
 ['payment','paid',false],['payment','status','pending'],['refund','id','other'],['refund','payment_id','other'],
 ['refund','status','pending'],['refund','status','canceled'],
])('rejects %s %s mismatch',(group,key,value)=>{const f=fixture();f[group][key]=value;expect(()=>verifyRecoveryA(f)).toThrow()})
test.each([{value:'10.00',currency:'USD'},{value:'11.00',currency:'RUB'},{value:'10',currency:'RUB'}])('rejects amount/currency mismatch %j',amount=>{const f=fixture();f.refund.amount=amount;expect(()=>verifyRecoveryA(f)).toThrow()})
test('rejects evidence changes',()=>{const f=fixture();f.evidence.operation.key='tampered';expect(()=>verifyRecoveryA(f)).toThrow()})
test('independent journal sees two POSTs despite one acceptance and one application audit',()=>{
 const observer=createRecoveryObserver();observer.post(operation,'refund');observer.post(operation,'refund')
 observer.trace.push('evidence_commit','suppression')
 expect(observer.accepted.size).toBe(1);expect(observer.calls).toHaveLength(2)
 expect(()=>observer.assertComplete()).toThrow() // Not swallowed by a flow catch.
})
test('rejects fabricated audit or wrong ordering',()=>{
 const empty=createRecoveryObserver();empty.trace.push('POST','accept','evidence_commit','suppression');expect(()=>empty.assertComplete()).toThrow()
 const wrong=createRecoveryObserver();wrong.post(operation,'refund');wrong.trace.push('suppression','evidence_commit');expect(()=>wrong.assertComplete()).toThrow()
})
test('observer survives recreation of the verifier process',()=>{
 const observer=createRecoveryObserver();observer.post(operation,'refund');observer.evidenceCommitted();observer.suppressed()
 const source="import {verifyRecoveryA} from './scripts/fiscal-recovery-a-verifier.js'; import fs from 'node:fs'; globalThis.fetch=()=>{throw Error('network forbidden')};verifyRecoveryA(JSON.parse(fs.readFileSync(0,'utf8')));"
 for(let i=0;i<2;i++){const result=spawnSync(process.execPath,['--input-type=module','-e',source],{input:JSON.stringify(fixture()),encoding:'utf8',windowsHide:true});expect(result.status,result.stderr).toBe(0)}
 observer.assertComplete()
})
test('committed evidence and fake audit cannot substitute actual rejected transport',async()=>{
 const observer=createRecoveryObserver();observer.post(operation,'refund');observer.evidenceCommitted()
 await observeLossBoundary(async()=>({ok:true}),()=>observer.suppressed())()
 observer.trace.push('suppression') // Deliberately false application audit.
 expect(()=>observer.assertComplete()).toThrow()
})
test('observes suppression only after transport rejection',async()=>{
 const observer=createRecoveryObserver();observer.post(operation,'refund');observer.evidenceCommitted()
 await expect(observeLossBoundary(async()=>{throw Error('synthetic response lost AFTER provider acceptance')},()=>observer.suppressed())()).rejects.toThrow('synthetic')
 observer.assertComplete()
})
test.each(['me','payments/payment','refunds/refund'])('fresh GET refuses changed or missing %s',async path=>{
 const f=fixture(),reads=createRecoveryReads(f.shop,f.payment);reads.resources.set('refunds/refund',f.refund)
 expect(await readRecoveryA({...f,get:reads.get})).toMatchObject({state:'succeeded'})
 reads.resources.set(path,{})
 await expect(readRecoveryA({...f,get:reads.get})).rejects.toThrow()
 reads.resources.delete(path)
 await expect(readRecoveryA({...f,get:reads.get})).rejects.toThrow('unconfirmed')
})
function parityFixture(){
 const timestamp='2026-10-08T00:00:00.123456+00:00',next='2026-10-08T00:01:00.654321+00:00'
 const before={billing_sandbox_refunds:[{id:'r',state:'sending',provider_refund_id:null,updated_at:timestamp,amount_minor:1000}],
 billing_subscription_fiscal_operation_status:[{command_id:'c',state:'unknown',provider_refund_id:null,receipt_status:null,checked_at:null,requires_review:false}],
 organization_subscriptions:[{organization_id:'o',revision:7,status:'active',plan_version_id:'pro',period_start:timestamp,period_end:next,cancel_at_period_end:false,scheduled_plan_version_id:null,scheduled_effective_at:null,created_at:timestamp},{organization_id:'foreign',revision:3,status:'active',created_at:timestamp}],subscription_refund_applications:[]}
 const after=structuredClone(before)
 Object.assign(after.billing_sandbox_refunds[0],{state:'succeeded',provider_refund_id:'provider',updated_at:next})
 Object.assign(after.billing_subscription_fiscal_operation_status[0],{state:'succeeded',provider_refund_id:'provider',receipt_status:'unknown',checked_at:next})
 Object.assign(after.organization_subscriptions[0],{revision:8,status:'free',plan_version_id:'free',period_start:null,period_end:null})
 after.subscription_refund_applications.push({request_id:'c',refund_id:'r',period_order_id:'period',before_state:structuredClone(before.organization_subscriptions[0]),after_state:structuredClone(after.organization_subscriptions[0]),applied_at:next})
 return {before,after,target:{commandId:'c',refundId:'r',organizationId:'o',periodOrderId:'period',providerId:'provider',freePlanId:'free'}}
}
test('exact parity allows only target rows and fields',()=>{const f=parityFixture();assertRecoveryParity(f.before,f.after,f.target)})
test('PostgreSQL JSON timestamps and subscription without updated_at follow actual schema',()=>{
 const f=parityFixture();expect(Object.hasOwn(f.before.organization_subscriptions[0],'updated_at')).toBe(false)
 expect(f.before.billing_subscription_fiscal_operation_status[0].checked_at).toBeNull()
 assertRecoveryParity(f.before,f.after,f.target)
})
test.each([
 ['organization_subscriptions','updated_at','2026-10-08T00:00:00Z'],
 ['organization_subscriptions','created_at','2026-10-09T00:00:00Z'],
 ['organization_subscriptions','created_at',undefined],
 ['billing_sandbox_refunds','updated_at',undefined],['billing_sandbox_refunds','updated_at',null],
 ['billing_sandbox_refunds','updated_at',42],['billing_sandbox_refunds','updated_at','not-a-date'],
 ['billing_subscription_fiscal_operation_status','checked_at',undefined],['billing_subscription_fiscal_operation_status','checked_at',null],
 ['subscription_refund_applications','applied_at',undefined],['subscription_refund_applications','applied_at',42],
])('rejects schema/timestamp mismatch %s.%s=%s',(table,field,value)=>{
 const f=parityFixture();if(value===undefined)delete f.after[table][0][field];else f.after[table][0][field]=value
 if(table==='organization_subscriptions')f.after.subscription_refund_applications[0].after_state=structuredClone(f.after[table][0])
 expect(()=>assertRecoveryParity(f.before,f.after,f.target)).toThrow()
})
test('missing initial checked_at is not equivalent to SQL NULL',()=>{
 const f=parityFixture();delete f.before.billing_subscription_fiscal_operation_status[0].checked_at
 expect(()=>assertRecoveryParity(f.before,f.after,f.target)).toThrow('exists')
})
test.each([7,9])('parity rejects incorrect target revision %i',revision=>{
 const f=parityFixture()
 f.after.organization_subscriptions[0].revision=revision
 f.after.subscription_refund_applications[0].after_state.revision=revision
 expect(()=>assertRecoveryParity(f.before,f.after,f.target)).toThrow('organization_subscriptions.revision')
})
test.each(['foreign_subscription','extra_field','changed_amount'])('parity catches %s',change=>{
 const f=parityFixture()
 if(change==='foreign_subscription')f.after.organization_subscriptions[1].status='free'
 else if(change==='extra_field')f.after.billing_sandbox_refunds[0].unexpected=true
 else f.after.billing_sandbox_refunds[0].amount_minor=2000
 expect(()=>assertRecoveryParity(f.before,f.after,f.target)).toThrow()
})
