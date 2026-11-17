// Test-only. No fetch, credentials, endpoint or deployment integration.
import assert from 'node:assert/strict'
export function verifyRecoveryA({operation,evidence,shop,payment,refund}) {
 const {commandId,shopId,paymentId,amountMinor,sha256}=operation
 assert.deepEqual(evidence.operation,operation,'immutable dispatch provenance')
 assert.equal(shop.account_id,shopId);assert.equal(shop.test,true)
 assert.equal(payment.id,paymentId);assert.equal(payment.test,true)
 assert.equal(payment.recipient.account_id,shopId);assert.equal(payment.status,'succeeded');assert.equal(payment.paid,true)
 assert.equal(refund.id,evidence.refundId);assert.equal(refund.payment_id,paymentId)
 assert.equal(refund.status,'succeeded');assert.equal(refund.amount.currency,'RUB')
 assert.match(refund.amount.value,/^\d+\.\d{2}$/)
 assert.equal(BigInt(refund.amount.value.replace('.','')),BigInt(amountMinor))
 return {commandId,shopId,paymentId,amountMinor,bodySha256:sha256,state:'succeeded',refundId:refund.id,receiptId:null,receiptStatus:'unknown'}
}

// The observer belongs to the test runner, outside disposable handlers/verifiers.
export function createRecoveryObserver() {
 const calls=[],accepted=new Map(),trace=[]
 let suppressions=0
 return {calls,trace,accepted,
  evidenceCommitted(){trace.push('evidence_commit')},
  suppressed(){suppressions++;trace.push('suppression')},
  post(operation,refundId) {
   calls.push({method:'POST',key:operation.key});trace.push('POST')
   if(!accepted.has(operation.key)) {accepted.set(operation.key,{id:refundId,payment_id:operation.paymentId,status:'succeeded',amount:operation.body.amount});trace.push('accept')}
   return structuredClone(accepted.get(operation.key))
  },
  assertComplete(){assert.equal(calls.length,1);assert.equal(accepted.size,1);assert.equal(suppressions,1);assert.deepEqual(trace,['POST','accept','evidence_commit','suppression'])},
 }
}

export function observeLossBoundary(transport,onSuppressed) {
 return async(...args)=>{try{return await transport(...args)}catch(error){
  if(error.message==='synthetic response lost AFTER provider acceptance')onSuppressed()
  throw error
 }}
}

export function createRecoveryReads(shop,payment) {
 const resources=new Map([['me',structuredClone(shop)],[`payments/${payment.id}`,structuredClone(payment)]])
 const calls=[]
 return {resources,calls,async get(path){calls.push(path);if(!resources.has(path))throw Error('fake GET unconfirmed');return structuredClone(resources.get(path))}}
}
export async function readRecoveryA({operation,evidence,get}) {
 const shop=await get('me'),payment=await get(`payments/${operation.paymentId}`),refund=await get(`refunds/${evidence.refundId}`)
 return verifyRecoveryA({operation,evidence,shop,payment,refund})
}

// Exact rows and columns, rather than removing entire mutable tables from parity.
export function assertRecoveryParity(before,after,{commandId,refundId,organizationId,periodOrderId,providerId,freePlanId}) {
 const normalized=structuredClone(after)
 const timestamp=(value,label)=>{
  assert.equal(typeof value,'string',label+' timestamp type')
  const parsed=Date.parse(value);assert.ok(Number.isFinite(parsed),label+' timestamp');return parsed
 }
 const adjust=(table,key,id,expected,variable=[])=>{
  const old=before[table].find(r=>r[key]===id),row=normalized[table].find(r=>r[key]===id)
  assert.ok(old&&row,table+' exact target exists')
  for(const [field,value] of Object.entries(expected))assert.deepEqual(row[field],value,table+'.'+field)
  for(const field of variable){
   assert.ok(Object.hasOwn(old,field)&&Object.hasOwn(row,field),table+'.'+field+' exists')
   const next=timestamp(row[field],table+'.'+field)
   if(old[field]===null)assert.equal(field,'checked_at','only checked_at may initially be null')
   else assert.ok(next>=timestamp(old[field],table+'.'+field+' before'))
  }
  for(const field of [...Object.keys(expected),...variable])row[field]=old[field]
 }
 adjust('billing_sandbox_refunds','id',refundId,{state:'succeeded',provider_refund_id:providerId},['updated_at'])
 adjust('billing_subscription_fiscal_operation_status','command_id',commandId,{state:'succeeded',provider_refund_id:providerId,receipt_status:'unknown'},['checked_at'])
 const previousRevision=before.organization_subscriptions.find(r=>r.organization_id===organizationId)?.revision
 assert.ok(Number.isSafeInteger(previousRevision)&&Number.isSafeInteger(previousRevision+1),'subscription revision must be exact')
 for(const rows of [before.organization_subscriptions,after.organization_subscriptions]){
  const subscription=rows.find(r=>r.organization_id===organizationId)
  assert.equal(Object.hasOwn(subscription,'updated_at'),false,'subscription schema has no updated_at')
  timestamp(subscription.created_at,'organization_subscriptions.created_at')
 }
 adjust('organization_subscriptions','organization_id',organizationId,{revision:previousRevision+1,status:'free',plan_version_id:freePlanId,period_start:null,period_end:null,cancel_at_period_end:false,scheduled_plan_version_id:null,scheduled_effective_at:null})
 const apps=normalized.subscription_refund_applications.filter(r=>r.request_id===commandId)
 assert.equal(apps.length,1);assert.equal(before.subscription_refund_applications.some(r=>r.request_id===commandId),false)
 const app=apps[0]
 assert.deepEqual(Object.keys(app).sort(),['request_id','refund_id','period_order_id','before_state','after_state','applied_at'].sort())
 assert.equal(app.refund_id,refundId);assert.equal(app.period_order_id,periodOrderId)
 assert.deepEqual(app.before_state,before.organization_subscriptions.find(r=>r.organization_id===organizationId))
 assert.deepEqual(app.after_state,after.organization_subscriptions.find(r=>r.organization_id===organizationId))
 timestamp(app.applied_at,'subscription_refund_applications.applied_at')
 normalized.subscription_refund_applications=normalized.subscription_refund_applications.filter(r=>r.request_id!==commandId)
 assert.deepEqual(normalized,before,'all other rows and fields unchanged')
}
