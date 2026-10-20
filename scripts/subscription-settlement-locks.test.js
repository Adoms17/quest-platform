// @vitest-environment node
import { test, expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
function docker(args,input) {
 const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:60000})
 if(r.status!==0)throw Error(r.stderr||'Docker failed')
 return r.stdout.trim()
}
test.skipIf(process.env.QVESTA_TEST_SETTLEMENT_LOCKS!=='1')('scheduled claim rechecks revocation and expiry after waiting on PostgreSQL lock',async()=>{
 const name='qvesta-settlement-locks-'+randomUUID().replaceAll('-',''),id='11111111-1111-4111-8111-111111111111'
 let created=false
 try {
  docker(['run','-d','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg; chown postgres:postgres /tmp/test-pg; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg']);created=true
  const args=['exec','-i',name,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
  const sql=s=>docker(args,s)
  for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);break}catch{await new Promise(r=>setTimeout(r,500))}}
  // Minimal storage isolates gateway locking; full-schema behavior is tested separately.
  sql(`create role anon;create role authenticated;create role service_role;create schema platform_private;
   create table billing_sandbox_orders(id uuid primary key,shop_id text,currency text,amount_minor bigint,period_start timestamptz,period_end timestamptz,organization_id uuid);
   create table billing_subscription_fiscal_terms(order_id uuid,policy_id uuid,period_start timestamptz,period_end timestamptz);
   create table billing_fiscal_policy_models(policy_id uuid,model_version text,settlement_basis text);
   create table billing_sandbox_payment_results(order_id uuid,shop_id text,status text,paid boolean,requires_review boolean,payment_id text);
   create table billing_receipt_payment_status(order_id uuid,status text,payment_id text);
   create table billing_sandbox_application_scope(organization_id uuid);
   create table billing_sandbox_refunds(order_id uuid,state text);
   create table billing_prepayment_settlement_status(order_id uuid,requires_review boolean,status text);
   create table claims(id uuid);
   create function public.claim_prepayment_settlement(p_order_id uuid) returns jsonb language plpgsql as $$ begin insert into claims values(p_order_id);return '{"action":"send"}'::jsonb;end;$$;`)
  const migration=readFileSync(new URL('../supabase/migrations/20260930020000_subscription_settlement_schedule.sql',import.meta.url),'utf8')
  sql(migration.slice(0,migration.indexOf('create function platform_private.run_scheduled_subscription_settlements()'))+'commit;')
  sql(`insert into billing_sandbox_orders values('${id}','1467641','RUB',100,now()-interval '1 hour',now()-interval '1 minute','${id}');
   insert into billing_subscription_fiscal_terms select id,id,period_start,period_end from billing_sandbox_orders;
   insert into billing_fiscal_policy_models values('${id}','subscription_access_v1','period_end');
   insert into billing_sandbox_payment_results values('${id}','1467641','succeeded',true,false,'test');
   insert into billing_receipt_payment_status values('${id}','succeeded','test');
   insert into billing_sandbox_application_scope values('${id}');
   insert into billing_sandbox_settlement_schedule(order_id,amount_minor,period_end,expires_at,enabled) select id,100,period_end,now()+interval '1 hour',true from billing_sandbox_orders;`)
  const concurrent=s=>new Promise(resolve=>{
   const c=spawn('docker',args,{windowsHide:true});let out='',err=''
   c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x)
   c.on('close',code=>resolve({code,out,err}));c.stdin.end(s)
  })
  const waitFor=async(application,event)=>{
   for(let i=0;i<100;i++){
    if(sql(`select count(*) from pg_stat_activity where application_name='${application}' and ${event};`)==='1')return
    await new Promise(r=>setTimeout(r,30))
   }
   throw Error('expected concurrent database wait not observed')
  }
  for(const mode of ['revoke','expire']) {
   sql(`update billing_sandbox_settlement_schedule set enabled=true,expires_at=clock_timestamp()+interval '${mode==='expire'?'3 seconds':'1 hour'}';`)
   const blocker=concurrent(`set application_name='settlement-blocker';begin;update billing_sandbox_settlement_schedule set enabled=${mode==='revoke'?'false':'true'} where order_id='${id}';select pg_sleep(5);commit;`)
   await waitFor('settlement-blocker',"wait_event='PgSleep'")
   const claimant=concurrent(`set application_name='settlement-claimant';select public.claim_scheduled_subscription_settlement('${id}');`)
   await waitFor('settlement-claimant',"wait_event_type='Lock'")
   const [left,right]=await Promise.all([blocker,claimant])
   expect(left.code).toBe(0);expect(right.code).not.toBe(0)
   expect(right.err).toContain('scheduled settlement denied')
   expect(sql('select count(*) from claims;')).toBe('0')
  }
 } finally {if(created)docker(['rm','-f',name])}
},90000)
