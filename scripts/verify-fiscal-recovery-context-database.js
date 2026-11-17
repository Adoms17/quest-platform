// Only called by the owned network-none disposable full-chain harness.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawn} from 'node:child_process'

export async function verifyRecoveryContextDatabase({sql,databaseId}) {
 const read=name=>readFileSync(new URL(name,import.meta.url),'utf8')
 const suite=name=>read('../supabase/tests/database/'+name+'.test.sql')
 const checked=(source,label)=>{
  const out=sql('set search_path=public,extensions;'+source)
  assert.doesNotMatch(out,/^not ok |Looks like/m,label)
  console.log('PASS '+label)
  return out
 }
 const paid=suite('checkout_documents_atomic').replace('10000,2,1','5000,2,1')
  .replace("'0','100 percent discount supported'","'6172','paid checkout with discount supported'")
 const prefix=suite('receipt_full_schema').split('savepoint settlement_fixture;')[0]
  .replace("now()-interval '1 hour',1,'service','full_prepayment');",`clock_timestamp()+interval '2 seconds',1,'service','full_prepayment');
   insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)
   values(md5('receipt-initial-policy')::uuid,'subscription','subscription_access_v1','ausn','period_end');select pg_sleep(2.1);`)
 const setup=paid.replace('select * from finish();rollback;',()=>suite('platform_order_documents')+'\n'+prefix+'\n'+
  suite('subscription_fiscal_refund_binding').split('-- LINKED_LIFECYCLE_CHECKS')[0]+'\n'+suite('subscription_fiscal_presend_commit'))
 assert.notEqual(setup,paid)
 const prepared=checked(setup,'full-chain synthetic committed sending/unknown fixture')
 const claim=JSON.parse(prepared.split(/\r?\n/).find(x=>x.startsWith('PRESEND_CLAIM|')).slice(14))
 const command=claim.commandId
 assert.match(command,/^[a-f0-9-]{36}$/)
 const actor=sql("select md5('discount-checkout-owner')::uuid").trim()
 const signature='public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb)'
 const beforeDefinition=sql(`select pg_get_functiondef('${signature}'::regprocedure)`)
 const beforeAcl=sql(`select proacl::text from pg_proc where oid='${signature}'::regprocedure`)
 sql(read('./fiscal-recovery-context.candidate.sql'))
 assert.equal(sql(`select proacl::text from pg_proc where oid='${signature}'::regprocedure`),beforeAcl)
 const finalDefinition=sql(`select pg_get_functiondef('${signature}'::regprocedure)`)
 assert.equal(finalDefinition.replace(",'read_recovery_context')", ")")
  .replace(/if p_action='read_recovery_context' then[\s\S]*?elsif p_action='status' then/,"if p_action='status' then"),beforeDefinition)
 assert.equal(sql("select count(*) from pg_proc where proname in ('append_recovery_evidence','commit_recovery_a','recover_fiscal_response_a')").trim(),'0')
 console.log('PASS candidate applied; existing gateway ACL unchanged; E/C absent')
 const session=`select set_config('qvesta.test.recovery_context_command_id','${command}',false);`
 checked(session+read('./fiscal-recovery-context.database.sql').replace('\\ir fiscal-recovery-context.fixture.sql',()=>read('./fiscal-recovery-context.fixture.sql')),'deferred pgTAP 28 assertions')
 sql(session+read('./fiscal-recovery-context.fixture.sql'))
 const evidence=sql(`select id from platform_private.recovery_context_fixture_evidence where command_id='${command}'`).trim()
 const epoch='floor(extract(epoch from clock_timestamp()))::bigint'
 const q=x=>"'"+String(x).replaceAll("'","''")+"'"
 const json=x=>q(JSON.stringify(x))+'::jsonb'
 const call=({action='read_recovery_context',mfa=epoch,exp=epoch+'+120',evidenceId=evidence,result}={})=>
  `public.subscription_fiscal_refund_from_gateway('${actor}',${mfa},${exp},'123',${q(action)},'${command}',${json(result??{evidenceId})})`
 const get=()=>JSON.parse(sql(`set role service_role;select ${call()}`).trim())
 const original=get()
 assert.equal(original.commandId,command)
 const tables=sql("select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ('public','platform_private') order by 1").trim().split(/\r?\n/)
 const snapshot=()=>sql('select md5(jsonb_agg(row_value order by name)::text) from ('+tables.map(t=>`select '${t}' as name, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as row_value from ${t} t`).join(' union all ')+') s').trim()
 const before=snapshot()
 const deny=source=>assert.throws(()=>sql(source),/recovery context denied|platform owner required|fiscal refund scope denied|sandbox environment denied/)
 for(const statement of ['update platform_private.recovery_context_fixture_evidence set state=state','delete from platform_private.recovery_context_fixture_evidence','truncate platform_private.recovery_context_fixture_evidence'])
  assert.throws(()=>sql('begin;'+statement+';rollback;'),/immutable/)
 console.log('PASS immutable evidence owner DML denied')
 for(const action of ['status','claim','before_send']) {
  const value=JSON.parse(sql(`set role service_role;select ${call({action,result:claim})}`).trim())
  if(action==='status')assert.equal(value.operationState,'unknown')
  if(action==='claim')assert.equal(value.action,'reconcile')
  if(action==='before_send')assert.equal(value.authorized,true)
 }
 assert.equal(snapshot(),before)
 console.log('PASS existing status/claim/before_send and zero table writes')
 checked(`begin;select plan(2);set local role service_role;
 select throws_ok($record$select ${call({action:'record',result:{shopId:'different'}})}$record$,'22023','fiscal result invalid','existing record validation retained');
 select is(${call({action:'review',result:{reason:'unidentified_refund'}})}->>'state','review','existing review branch retained');
 select * from finish();rollback;`,'existing record/review branches under rollback')
 assert.equal(snapshot(),before)
 checked(`begin;select plan(5);select set_config('request.jwt.claims','{"sentinel":"unchanged"}',true);
 select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
 set local role service_role;select ${call()};
 select is(current_setting('request.jwt.claims'),' {"sentinel":"unchanged"}'::text::jsonb::text,'success restores claims');
 select is(current_setting('request.jwt.claim.sub'),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','success restores subject');
 select throws_ok($deny$select ${call({evidenceId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}$deny$,'42501','recovery context denied','failure remains uniform');
 select is(current_setting('request.jwt.claims'),'{"sentinel":"unchanged"}','failure restores claims');
 select is(current_setting('request.jwt.claim.sub'),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','failure restores subject');
 select * from finish();rollback;`.replace("' {\"sentinel\":\"unchanged\"}'::text::jsonb::text","'{\"sentinel\":\"unchanged\"}'"),'claims restoration and uniform denial')
 // A context is scoped to its organization: unrelated profile data must not change its digest.
 const changed=JSON.parse(sql(`begin;update public.organization_subscriptions set cancel_at_period_end=not cancel_at_period_end where organization_id='${original.organizationId}';set local role service_role;select ${call()};rollback;`).trim())
 assert.notEqual(changed.snapshotDigest,original.snapshotDigest)
 const unrelated=JSON.parse(sql(`begin;update public.organizations set name=name||' unrelated' where id<>'${original.organizationId}';set local role service_role;select ${call()};rollback;`).trim())
 assert.equal(unrelated.snapshotDigest,original.snapshotDigest)
 assert.equal(get().snapshotDigest,original.snapshotDigest)
 console.log('PASS scoped digest relevant subscription changes / unrelated data stable / rollback restores')
 for(const mutation of [
  `update public.billing_subscription_fiscal_ledgers set version=version+1 where order_id='${original.orderId}'`,
  `update public.organization_subscriptions set period_end=period_end+interval '1 day' where organization_id='${original.organizationId}'`,
 ]) {
  const observation=JSON.parse(sql(`begin;${mutation};set local role service_role;select ${call()};rollback;`).trim())
  assert.notEqual(observation.snapshotDigest,original.snapshotDigest)
 }
 for(const mutation of [
  `update public.billing_sandbox_payment_results set requires_review=true where order_id='${original.orderId}'`,
  `update public.billing_subscription_fiscal_operation_status set requires_review=true where command_id='${command}'`,
 ])deny(`begin;${mutation};set local role service_role;select ${call()};rollback;`)
 assert.equal(snapshot(),before)
 console.log('PASS ledger/access-period digest changes and payment/fiscal review denials')
 // Owner-only transaction-local pin corruption exercises guard denials without changing its implementation.
 for(const mode of ['production','unpinned']) {
  deny(`begin;alter table platform_private.billing_runtime_environment disable trigger billing_environment_identity_immutable;
   ${mode==='production'?"update platform_private.billing_runtime_environment set environment='production'":"delete from platform_private.billing_runtime_environment"};
   set local role service_role;select ${call()};rollback;`)
  assert.equal(get().snapshotDigest,original.snapshotDigest)
 }
 console.log('PASS production/unpinned guards; owner-only perturbations rolled back')

 // Existing foreign evidence: separate order/organization and valid linked reserved rows.
 // All fixture INSERT/UPDATE statements run as owner under normal FK/check/trigger enforcement.
 const fid=name=>"md5('r-foreign-"+name+"')::uuid"
 const otherOrg="(select id from public.organizations where personal_owner_id=md5('receipt-other-user')::uuid)"
 const clone=(table,where,changes)=>`insert into public.${table} select (jsonb_populate_record(null::public.${table},to_jsonb(t)||jsonb_build_object(${changes}))).* from public.${table} t where ${where};`
 const foreignSetup=`
  select set_config('request.jwt.claim.sub','${actor}',true);
  ${clone('billing_sandbox_orders',"id='"+original.orderId+"'",`'id',${fid('order')},'organization_id',${otherOrg},'command_id',${fid('order-command')},'idempotency_key',${fid('order-key')},'state','reserved','first_sent_at',null`)}
  ${clone('billing_receipt_snapshots',"order_id='"+original.orderId+"'",`'order_id',${fid('order')}`)}
  ${clone('billing_subscription_fiscal_ledgers',"order_id='"+original.orderId+"'",`'order_id',${fid('order')},'payment_id',${fid('payment')}`)}
  ${clone('subscription_refund_requests',"id='"+command+"'",`'id',${fid('command')},'command_id',${fid('request-command')},'order_id',${fid('order')},'organization_id',${otherOrg}`)}
  ${clone('billing_subscription_fiscal_operations',"command_id='"+command+"'",`'command_id',${fid('command')},'order_id',${fid('order')},'idempotency_key',${fid('key')}`)}
  insert into public.billing_subscription_fiscal_operation_status(command_id) values(${fid('command')});
  ${clone('billing_sandbox_refunds',"id='"+original.internalRefundId+"'",`'id',${fid('refund')},'order_id',${fid('order')},'command_id',${fid('command')},'fiscal_command_id',${fid('command')},'payment_id',${fid('payment')},'state','reserved','first_sent_at',null`)}
  insert into public.subscription_refund_dispatches select ${fid('refund')},actor_id,authorized_at from public.subscription_refund_dispatches where refund_id='${original.internalRefundId}';
  update public.billing_subscription_fiscal_operation_status set state='unknown',first_sent_at=(select authorized_at from public.subscription_refund_dispatches where refund_id=${fid('refund')}) where command_id=${fid('command')};
  update public.billing_sandbox_refunds set state='sending',first_sent_at=(select authorized_at from public.subscription_refund_dispatches where refund_id=${fid('refund')}) where id=${fid('refund')};
  insert into platform_private.recovery_context_fixture_evidence select (jsonb_populate_record(null::platform_private.recovery_context_fixture_evidence,
   to_jsonb(e)||jsonb_build_object('id',${fid('evidence')},'command_id',${fid('command')},'refund_id',${fid('refund')},'provider_refund_id',${fid('provider')},'payment_id',${fid('payment')},'key_digest',encode(extensions.digest(convert_to(${fid('key')}::text,'UTF8'),'sha256'),'hex')))).*
   from platform_private.recovery_context_fixture_evidence e where id='${evidence}';
 `
 checked(`begin;select plan(2);${foreignSetup}
 select is((select count(*)::int from platform_private.recovery_context_fixture_evidence),2,'foreign evidence really exists');
 set local role service_role;
 select throws_ok($deny$select ${call({evidenceId:'foreign'}).replace(json({evidenceId:'foreign'}),"jsonb_build_object('evidenceId',"+fid('evidence')+")")}$deny$,'42501','recovery context denied','existing foreign evidence has same denial');
 select * from finish();rollback;`,'existing foreign evidence uniform SQLSTATE/message')
 assert.equal(snapshot(),before)
 const asyncSql=source=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',databaseId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,timeout:25000})
  let output='',error='';child.stdout.on('data',x=>{output+=x});child.stderr.on('data',x=>{error+=x})
  child.on('error',reject);child.on('close',code=>resolve({code,output,error}))
  child.stdin.end("set statement_timeout='20s';"+source)
 })
 const waitFor=async query=>{for(let i=0;i<60;i++){if(sql(query).trim()==='1')return;await new Promise(r=>setTimeout(r,50))}throw Error('DB lock barrier not observed')}
 // Lock the subscription AFTER the gateway's entry checks, so only the final DB-clock barrier can deny.
 for(const mode of ['expiry','mfa','scope','owner','snapshot']) {
  let holder,reader
  const stamp=Number(sql('select '+epoch).trim())
  let mutation=''
  if(mode==='scope')mutation=`delete from public.billing_sandbox_application_scope where organization_id='${original.organizationId}';`
  if(mode==='owner')mutation=`update public.platform_access_assignments set revoked_at=clock_timestamp() where user_id='${actor}' and role_key='owner';`
  if(mode==='snapshot')mutation=`update public.organization_subscriptions set cancel_at_period_end=not cancel_at_period_end where organization_id='${original.organizationId}';`
  try {
   holder=asyncSql(`set application_name='r_holder';begin;select 1 from public.organization_subscriptions where organization_id='${original.organizationId}' for update;select pg_sleep(5);${mutation}commit;`)
   await waitFor("select count(*) from pg_stat_activity where application_name='r_holder' and wait_event='PgSleep'")
   reader=asyncSql(`set application_name='r_reader';set role service_role;select ${call({mfa:mode==='mfa'?String(stamp-296):String(stamp),exp:mode==='expiry'?String(stamp+4):String(stamp+120)})}`)
   await waitFor("select count(*) from pg_stat_activity where application_name='r_reader' and wait_event_type='Lock' and exists(select 1 from pg_stat_activity h where h.application_name='r_holder' and h.pid=any(pg_blocking_pids(pg_stat_activity.pid)))")
   const [a,b]=await Promise.all([holder,reader]);assert.equal(a.code,0,a.error)
   if(mode==='snapshot') {assert.equal(b.code,0,b.error);assert.equal(JSON.parse(b.output.trim()).snapshotDigest,get().snapshotDigest);assert.notEqual(get().snapshotDigest,original.snapshotDigest)}
   else {assert.notEqual(b.code,0);assert.match(b.error,/recovery context denied/);assert.ok(!b.error.includes(evidence));assert.ok(!b.error.includes(original.evidence.providerRefundId))}
   console.log('PASS two-backend real lock wait '+mode)
  } finally {await Promise.allSettled([holder,reader].filter(Boolean))}
  if(mode==='scope')sql(`insert into public.billing_sandbox_application_scope values('${original.organizationId}')`)
  if(mode==='owner')sql(`update public.platform_access_assignments set revoked_at=null where user_id='${actor}' and role_key='owner'`)
  if(mode==='snapshot')sql(`update public.organization_subscriptions set cancel_at_period_end=not cancel_at_period_end where organization_id='${original.organizationId}'`)
 }
 assert.notEqual(get().snapshotDigest,original.snapshotDigest) // Committed subscription changes legitimately advance revision.
 assert.ok(beforeDefinition.includes("p_action='status'"))
 console.log('R_CONTEXT_DATABASE_COMPLETE')
}
