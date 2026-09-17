// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
const enabled=process.env.RUN_LOCAL_QUOTA_E2E==='1'
function sql(query){return new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i','supabase_db_quest-platform','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});let out='',error=''
 p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>error+=d);p.on('error',reject);p.on('close',code=>resolve({code,out,error}));p.stdin.end("set statement_timeout='15s';\n"+query)
})}
test.skipIf(!enabled).each(['commit','rollback'])('два возврата не превышают оплату: %s',async mode=>{
 const actor=randomUUID(),order=randomUUID(),payment=randomUUID(),one=randomUUID(),two=randomUUID()
 const org=`(select id from public.organizations where personal_owner_id='${actor}')`
 const auth=`set local role service_role;select set_config('request.jwt.claim.sub','${actor}',true);`
 let first,second
 try {
  const setup=await sql(`insert into auth.users(id,email) values('${actor}','${actor}@example.test');
   insert into public.billing_sandbox_refund_operators values('${actor}');insert into public.billing_sandbox_application_scope select ${org};
   insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,first_sent_at,state)
   select '${order}',${org},'${actor}',gen_random_uuid(),id,0,100,'RUB','123','https://stage.qvesta.ru',now(),now()+interval '1 day',now(),'finished' from public.billing_plan_versions where plan_key='pro' and version=1;
   insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid) values('${order}','123','${payment}','succeeded',true);`)
  expect(setup.code,setup.error).toBe(0)
  first=sql(`set application_name='refund_first_${actor}';begin;${auth}select public.reserve_sandbox_refund('${order}','${one}',60);select pg_sleep(3);${mode};`)
  let holding=false
  for(let i=0;i<30;i++){const state=await sql(`select count(*) from pg_stat_activity where application_name='refund_first_${actor}' and wait_event='PgSleep';`);if(state.out.trim()==='1'){holding=true;break}await new Promise(r=>setTimeout(r,40))}
  expect(holding).toBe(true)
  second=sql(`set application_name='refund_second_${actor}';begin;${auth}select public.reserve_sandbox_refund('${order}','${two}',60);commit;`)
  let blocked=false
  for(let i=0;i<30;i++){const state=await sql(`select count(*) from pg_stat_activity where application_name='refund_second_${actor}' and wait_event_type='Lock';`);if(state.out.trim()==='1'){blocked=true;break}await new Promise(r=>setTimeout(r,40))}
  expect(blocked).toBe(true)
  const [a,b]=await Promise.all([first,second]);expect(a.code,a.error).toBe(0)
  if(mode==='commit'){expect(b.code).not.toBe(0);expect(b.error).toContain('refund amount exceeded')}else expect(b.code,b.error).toBe(0)
  const total=await sql(`select count(*)||':'||sum(amount_minor) from public.billing_sandbox_refunds where order_id='${order}';`)
  expect(total.out.trim()).toBe('1:60')
 }finally{
  await Promise.allSettled([first,second].filter(Boolean))
  const cleanup=await sql(`delete from public.billing_sandbox_refunds where order_id='${order}';delete from public.billing_sandbox_payment_results where order_id='${order}';delete from public.billing_sandbox_orders where id='${order}';
   delete from public.billing_sandbox_application_scope where organization_id=${org};delete from public.billing_sandbox_refund_operators where actor_id='${actor}';
   delete from public.organizations where personal_owner_id='${actor}';delete from public.participant_profiles where created_by_user_id='${actor}';delete from public.profiles where id='${actor}';delete from auth.users where id='${actor}';`)
  expect(cleanup.code,cleanup.error).toBe(0)
 }
},60000)
