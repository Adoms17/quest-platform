import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'

// Только контейнер, созданный текущим replay; общая локальная БД не используется.
export async function verifyPlatformRefundConcurrency(container, sql) {
 if (!/^qvesta-release-test-[0-9a-f]+$/.test(container)) throw Error('isolated container required')
 const asyncSql = source => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'], {windowsHide:true})
  let output='',error=''
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk)
  child.on('error',reject);child.on('close',code=>resolve({code,output,error}))
  child.stdin.end("set statement_timeout='15s';"+source)
 })
 for (const mode of ['commit','rollback','same-command']) {
  const actor=randomUUID(),order=randomUUID(),payment=randomUUID(),one=randomUUID(),two=mode==='same-command'?one:randomUUID()
  const org="(select id from public.organizations where personal_owner_id='"+actor+"')"
  sql(`insert into auth.users(id,email) values('${actor}','concurrency-${mode}@example.test');
   insert into public.platform_access_assignments(user_id,role_key,scope_kind) values('${actor}','owner','platform');
   insert into public.billing_sandbox_application_scope select ${org};
   insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,state)
   select '${order}',${org},'${actor}',gen_random_uuid(),id,0,100,'RUB','123','https://stage.qvesta.ru',now(),now()+interval '1 day','finished' from public.billing_plan_versions where plan_key='pro' and version=1;
   insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid) values('${order}','123','${payment}','succeeded',true);`)
  const organization=sql(`select id from public.organizations where personal_owner_id='${actor}';`).trim()
  const auth=`select set_config('request.jwt.claim.sub','${actor}',true);
   select set_config('request.jwt.claims',jsonb_build_object('sub','${actor}','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
   set local role authenticated;`
  const confirm=command=>`select public.confirm_platform_sandbox_refund('${organization}','${order}',60,'customer_request','${command}');`
  let first,second
  try {
   first=asyncSql(`set application_name='first_${actor}';begin;${auth}${confirm(one)}select pg_sleep(3);${mode==='rollback'?'rollback':'commit'};`)
   let sleeping=false
   for(let i=0;i<40;i++){
    if(sql(`select count(*) from pg_stat_activity where application_name='first_${actor}' and wait_event='PgSleep';`).trim()==='1'){sleeping=true;break}
    await new Promise(resolve=>setTimeout(resolve,25))
   }
   expect(sleeping,mode+' first reserved').toBe(true)
   second=asyncSql(`set application_name='second_${actor}';begin;${auth}${confirm(two)}commit;`)
   let blocked=false
   for(let i=0;i<40;i++){
    if(sql(`select count(*) from pg_stat_activity where application_name='second_${actor}' and wait_event_type='Lock';`).trim()==='1'){blocked=true;break}
    await new Promise(resolve=>setTimeout(resolve,25))
   }
   expect(blocked,mode+' concurrent request waits').toBe(true)
   const [a,b]=await Promise.all([first,second])
   expect(a.code,a.error).toBe(0)
   if(mode==='commit'){expect(b.code).not.toBe(0);expect(b.error).toContain('invalid refund amount')}
   else expect(b.code,b.error).toBe(0)
   expect(sql(`select count(*)||':'||sum(amount_minor) from public.billing_sandbox_refunds where order_id='${order}';`).trim()).toBe('1:60')
   expect(sql(`select count(*) from public.platform_refund_commands where order_id='${order}';`).trim()).toBe('1')
  } finally { await Promise.allSettled([first,second].filter(Boolean)) }
 }
}
