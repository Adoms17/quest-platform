import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export function scheduleSql(mode, orderId) {
 if (!['preview','provision','enable','disable'].includes(mode)) throw Error('Invalid schedule mode')
 if(mode==='disable')return readFileSync(new URL('./disable-stage-subscription-settlement.sql',import.meta.url),'utf8')
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(orderId||''))throw Error('Exact order UUID required')
 const source=readFileSync(new URL('./stage-subscription-settlement-admission.sql',import.meta.url),'utf8').replace(/^\uFEFF/,'')
 if(!/^begin;/.test(source)||!/rollback;\s*$/.test(source))throw Error('Unexpected admission transaction')
 const body=source.replace(/^begin;/,`begin;\nselect set_config('qvesta.settlement_order_id','${orderId}',true);\nselect set_config('qvesta.settlement_schedule_mode','${mode==='preview'?'preview':'provision'}',true);`)
 const activation=mode==='enable'?`
 do $enable$
 declare job bigint;
 begin
  select jobid into strict job from cron.job where jobname='quest-stage-subscription-settlement'
   and schedule='* * * * *' and not active
   and command=$cmd$set statement_timeout='45s'; set lock_timeout='5s'; select platform_private.run_scheduled_subscription_settlements();$cmd$;
  if not exists(select 1 from vault.secrets where name='qvesta_stage_reconcile_worker_token') then
   raise exception 'scheduler credential missing'; end if;
  update public.billing_sandbox_settlement_schedule set enabled=true where order_id='${orderId}';
  perform cron.alter_job(job,active:=true);
 end; $enable$;
 `:''
 return body.replace(/rollback;\s*$/,activation+(mode==='preview'?'rollback;':'commit;')+'\n')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.SUPABASE_PROJECT_ID!=='jeugfyaqzfgdvfhdxfht'||process.env.GITHUB_REF!=='refs/heads/staging')throw Error('Stage only')
 writeFileSync(process.argv[3],scheduleSql(process.argv[2],process.env.SANDBOX_ORDER_ID))
}
