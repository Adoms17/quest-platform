// Disposable owner-fixture proof, not a public authorization/provider authenticity test.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRecoveryObserver,verifyRecoveryA,createRecoveryReads,readRecoveryA,assertRecoveryParity} from './fiscal-recovery-a-verifier.js'
export function prepareRecoveryA({sql,commandId,actorId}) {
 sql(readFileSync(new URL('./fiscal-recovery-a.candidate.sql',import.meta.url),'utf8'))
 const observer=createRecoveryObserver(),evidenceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 const eventId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 const q=value=>"'"+String(value).replaceAll("'","''")+"'"
 const j=value=>q(JSON.stringify(value))+'::jsonb'
 const payment=JSON.parse(sql(`select jsonb_build_object('id',f.payment_id,'test',true,'recipient',jsonb_build_object('account_id',o.shop_id),'status','succeeded','paid',true) from public.billing_sandbox_refunds f join public.billing_sandbox_orders o on o.id=f.order_id where f.fiscal_command_id='${commandId}'`).trim())
 const reads=createRecoveryReads({account_id:'123',test:true},payment)
 let result,operation
 const callbacks={
  onPost:(op,id)=>reads.resources.set(`refunds/${id}`,observer.post(op,id)),
  onSuppressed:()=>observer.suppressed(),
  afterAccepted:async(op,id)=>{
   operation=op
   const evidence={operation:op,refundId:id}
   result=verifyRecoveryA({operation:op,evidence,shop:{account_id:'123',test:true},
    payment:{id:op.paymentId,test:true,recipient:{account_id:'123'},status:'succeeded',paid:true},
    refund:observer.accepted.get(op.key)})
   sql(`begin;insert into platform_private.recovery_a_evidence values('${evidenceId}','${commandId}','${id}',${j(op)},${j(result)});commit;`)
   assert.equal(sql(`select count(*) from platform_private.recovery_a_evidence where id='${evidenceId}'`).trim(),'1')
   observer.evidenceCommitted()
  },
 }
 return {callbacks,async verify({asyncSql,snapshot}) {
  observer.assertComplete() // Outside the production flow catch boundary.
  assert.ok(operation)
  const before=snapshot(),cas=sql('select platform_private.recovery_a_snapshot()').trim()
  const evidence={operation,refundId:result.refundId},refundPath=`refunds/${result.refundId}`
  const originalRefund=structuredClone(reads.resources.get(refundPath))
  reads.resources.set(refundPath,{...originalRefund,payment_id:'wrong-payment'})
  await assert.rejects(readRecoveryA({operation,evidence,get:reads.get}))
  reads.resources.delete(refundPath)
  await assert.rejects(readRecoveryA({operation,evidence,get:reads.get}),/unconfirmed/)
  assert.deepEqual(snapshot(),before)
  reads.resources.set(refundPath,originalRefund)
  const getBoundary=reads.calls.length
  result=await readRecoveryA({operation,evidence,get:reads.get})
  assert.deepEqual(reads.calls.slice(getBoundary),['me',`payments/${operation.paymentId}`,refundPath])
  const epoch=Math.floor(Date.now()/1000)
  const call=({actor=actorId,mfa=epoch,exp=epoch+300,event=eventId,expected=cas,value=result,evidence=evidenceId}={})=>
   `select platform_private.recover_fiscal_response_a('${actor}',${mfa},${exp},'123','${commandId}','${evidence}','${event}',${q(expected)},${j(value)})`
  const deny=(statement,pattern)=>assert.throws(()=>sql(statement),pattern)
  deny(call({mfa:epoch-301}),/42501|invalid fiscal refund gateway context/)
  deny(call({exp:epoch-1}),/42501|invalid fiscal refund gateway context/)
  deny(call({actor:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),/42501|invalid fiscal refund gateway context/)
  deny(call({expected:'changed'}),/unconfirmed/)
  deny(call({evidence:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),/unconfirmed/)
  deny(call({value:{...result,refundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}),/mismatch/)
  // Transaction-local state perturbations must roll back on rejection.
  deny(`begin;update public.billing_subscription_fiscal_operation_status set requires_review=true where command_id='${commandId}';${call()};rollback;`,/unconfirmed/)
  const nonowner=sql(`select id from auth.users where id<>'${actorId}' order by id limit 1`).trim()
  assert.match(nonowner,/^[a-f0-9-]{36}$/)
  deny(call({actor:nonowner}),/platform owner required/)
  assert.deepEqual(snapshot(),before)
  const signatures=['platform_private.recovery_a_snapshot()',
   'platform_private.recover_fiscal_response_a(uuid,bigint,bigint,text,uuid,uuid,uuid,text,jsonb)']
  for(const role of ['anon','authenticated','service_role']) {
   for(const signature of signatures)assert.equal(sql(`select has_function_privilege('${role}',${q(signature)},'EXECUTE')`).trim(),'f')
   deny(`begin;set local role ${role};${call()};rollback;`,/permission denied/)
   deny(`begin;set local role ${role};select platform_private.recovery_a_snapshot();rollback;`,/permission denied/)
   for(const table of ['recovery_a_evidence','recovery_a_decisions'])deny(`begin;set local role ${role};select * from platform_private.${table};rollback;`,/permission denied/)
  }
  assert.equal(sql("select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid in ('platform_private.recovery_a_snapshot()'::regprocedure,'platform_private.recover_fiscal_response_a(uuid,bigint,bigint,text,uuid,uuid,uuid,text,jsonb)'::regprocedure) and a.grantee=0").trim(),'0')
  // Atomicity on outer rollback; no binding/application/decision survives.
  sql(`begin;${call()};rollback;`)
  assert.deepEqual(snapshot(),before)
  assert.equal(sql('select count(*) from platform_private.recovery_a_decisions').trim(),'0')
  // A scheduled plan makes the exact access period unsafe. Preserve verified money.
  const accessReview=sql(`begin;
   update public.organization_subscriptions set scheduled_plan_version_id=plan_version_id,scheduled_effective_at=period_end
    where organization_id=(select organization_id from public.subscription_refund_requests where id='${commandId}');
   ${call().replace(q(cas),'platform_private.recovery_a_snapshot()')};
   select 'APPLICATIONS|'||count(*) from public.subscription_refund_applications;
   select 'MONEY|'||state from public.billing_sandbox_refunds where fiscal_command_id='${commandId}';rollback;`).trim().split(/\r?\n/)
  const reviewResult=JSON.parse(accessReview.find(line=>line.startsWith('{')))
  assert.equal(reviewResult.state,'succeeded');assert.equal(reviewResult.accessState,'review_required')
  assert.ok(accessReview.includes('APPLICATIONS|0'));assert.ok(accessReview.includes('MONEY|succeeded'))
  assert.deepEqual(snapshot(),before)
  // Fresh observations again immediately before the committing recovery attempt.
  const commitGetBoundary=reads.calls.length
  result=await readRecoveryA({operation,evidence,get:reads.get})
  assert.deepEqual(reads.calls.slice(commitGetBoundary),['me',`payments/${operation.paymentId}`,refundPath])
  // Separate psql processes; second blocks on existing owner lock, then returns saved event.
  let holder,waiter,outcomes
  const waitFor=async(query)=>{for(let i=0;i<60;i++){if(sql(query).trim()==='1')return;await new Promise(resolve=>setTimeout(resolve,50))}assert.fail('lock barrier not observed')}
  try {
   holder=asyncSql(`set application_name='recovery_a_holder';begin;${call()};select pg_sleep(5);commit;`)
   await waitFor("select count(*) from pg_stat_activity where application_name='recovery_a_holder' and wait_event='PgSleep'")
   waiter=asyncSql(`set application_name='recovery_a_waiter';set lock_timeout='10s';begin;${call()};commit;`)
   await waitFor("select count(*) from pg_stat_activity where application_name='recovery_a_waiter' and wait_event_type='Lock' and exists(select 1 from pg_stat_activity h where h.application_name='recovery_a_holder' and h.pid=any(pg_blocking_pids(pg_stat_activity.pid)))")
   outcomes=await Promise.all([holder,waiter])
  } finally {await Promise.allSettled([holder,waiter].filter(Boolean))}
  for(const value of outcomes)assert.equal(value.code,0,value.error)
  const replays=outcomes.map(value=>JSON.parse(value.output.split(/\r?\n/).find(line=>line.startsWith('{'))).replay).sort()
  assert.deepEqual(replays,[false,true])
  const after=snapshot()
  assert.equal(after.subscription_refund_applications.length,1)
  assert.equal(after.billing_sandbox_refunds[0].state,'succeeded')
  assert.equal(after.billing_subscription_fiscal_operation_status[0].state,'succeeded')
  assert.equal(after.billing_subscription_fiscal_operation_status[0].receipt_status,'unknown')
  assert.equal(after.organization_subscriptions[0].status,'free')
  const target=before.subscription_refund_requests.find(r=>r.id===commandId)
  const binding=before.subscription_refund_period_bindings.find(r=>r.request_id===commandId)
  const freePlanId=sql("select platform_private.current_tariff_version('free',clock_timestamp())").trim()
  assertRecoveryParity(before,after,{commandId,refundId:before.billing_sandbox_refunds.find(r=>r.fiscal_command_id===commandId).id,
   organizationId:target.organization_id,periodOrderId:binding.period_order_id,providerId:result.refundId,freePlanId})
  // Deliberately discard both committed responses; fresh exact retry uses OLD CAS.
  const replay=JSON.parse(sql(call()).trim())
  assert.equal(reads.calls.length,commitGetBoundary+3,'exact replay does not perform new provider GET')
  assert.equal(replay.replay,true);assert.equal(replay.state,'succeeded');assert.equal(replay.accessState,'applied')
  assert.deepEqual(snapshot(),after)
  deny(call({value:{...result,amountMinor:result.amountMinor+1}}),/event conflict/)
  deny(call({event:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}),/unconfirmed/)
  deny(call({exp:epoch-1}),/invalid fiscal refund gateway context/)
  deny(`begin;update public.platform_access_assignments set revoked_at=clock_timestamp() where user_id='${actorId}' and role_key='owner';${call()};rollback;`,/platform owner required/)
  assert.deepEqual(snapshot(),after)
  observer.assertComplete()
  assert.equal(sql('select count(*) from platform_private.recovery_a_decisions').trim(),'1')
  console.log('RECOVERY_A: POST=1 accepted=1 evidence_before_suppression=true exact_retry=true concurrent_duplicate=true applications=1 ACL_denials=true')
 }}
}
