import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'

export async function verifyTrialCheckoutConcurrency(container, sql) {
 if (!/^qvesta-release-test-[0-9a-f]+$/.test(container)) throw Error('isolated container required')
 const run = source => new Promise((resolve,reject) => {
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
  let output='',error=''
  child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v)
  child.on('error',reject);child.on('close',code=>resolve({code,output,error}))
  child.stdin.end("set statement_timeout='15s';"+source)
 })
 const fixture=readFileSync(new URL('../supabase/tests/database/billing_trial_full_price_schedule.test.sql',import.meta.url),'utf8').split("select is(public.apply_sandbox_payment_event")[0]
 for (const mode of ['commit','rollback']) {
  const source=fixture.replaceAll('TRIAL-CODE',`RACE-CODE-${mode}`).replaceAll('purchase_trial',`race_${mode}`).replaceAll('purchase_other',`race_other_${mode}`).replaceAll('purchase-trial',`race-${mode}`).replaceAll('trial-offer',`race-offer-${mode}`).replaceAll('trial-command',`race-command-${mode}`).replaceAll('trial-money',`race-money-${mode}`).replaceAll('trial-discount',`race-discount-${mode}`).replace("interval '5 seconds'","interval '1 hour'")
  sql('create extension if not exists pgtap with schema extensions; set search_path=public,extensions;'+source+'commit;')
  const org=sql(`select id from public.organizations where personal_owner_id=md5('race-${mode}-owner')::uuid;`).trim()
  const event=`md5('race-money-${mode}-event')::uuid`,payment=`md5('race-money-${mode}-provider')::uuid`
  let first,second
  try {
   first=run(`set application_name='trial_first_${mode}';begin;select public.apply_sandbox_payment_event(${event},jsonb_build_object('paymentId',${payment},'status','succeeded','paid',true,'test',true));select pg_sleep(3);${mode};`)
   let sleeping=false
   for(let i=0;i<40;i++) { if(sql(`select count(*) from pg_stat_activity where application_name='trial_first_${mode}' and wait_event='PgSleep';`).trim()==='1'){sleeping=true;break} await new Promise(r=>setTimeout(r,25)) }
   expect(sleeping).toBe(true)
   second=run(`set application_name='trial_second_${mode}';begin;select set_config('request.jwt.claim.sub',md5('race-${mode}-owner')::uuid::text,true);select platform_private.capture_trial_checkout_terms('${org}',md5('race-offer-${mode}')::uuid);commit;`)
   let blocked=false
   for(let i=0;i<40;i++) { if(sql(`select count(*) from pg_stat_activity where application_name='trial_second_${mode}' and wait_event_type='Lock';`).trim()==='1'){blocked=true;break} await new Promise(r=>setTimeout(r,25)) }
   expect(blocked).toBe(true)
   const [a,b]=await Promise.all([first,second]);expect(a.code,a.error).toBe(0)
   if(mode==='commit'){expect(b.code).not.toBe(0);expect(b.error).toContain('trial paid period already scheduled')}
   else expect(b.code,b.error).toBe(0)
   expect(sql(`select count(*) from public.billing_trial_paid_periods where organization_id='${org}';`).trim()).toBe(mode==='commit'?'1':'0')
  } finally { await Promise.allSettled([first,second].filter(Boolean)) }
 }
}
