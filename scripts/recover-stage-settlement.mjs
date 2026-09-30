import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSandboxHttpClient } from '../supabase/functions/_shared/yookassaSandboxHttp.js'
const project = 'jeugfyaqzfgdvfhdxfht'
const order = '80fac987-e40e-4521-8f94-ffbc3193ca32'
const payment = '324f7174-000f-5001-a000-179c65421768'
const exec = promisify(execFile)
export function parseQueryRows(stdout) {
 const data = JSON.parse(stdout)
 const rows = Array.isArray(data) ? data : data?.rows
 if (!Array.isArray(rows)) throw Error('recovery query format denied')
 return rows
}
export const guard = `
do $guard$ begin
 if not exists(select 1 from public.billing_sandbox_orders o
 join public.billing_sandbox_payment_results p on p.order_id=o.id
 join public.billing_prepayment_settlements r on r.order_id=o.id
 join public.billing_prepayment_settlement_status s on s.order_id=o.id
 join public.billing_sandbox_settlement_schedule q on q.order_id=o.id
 where o.id='${order}' and o.organization_id='e2790c93-7bfa-7992-f6f0-74f1cf1c79e5'
 and o.shop_id='1467641' and o.amount_minor=99000 and o.currency='RUB'
 and p.payment_id='${payment}' and p.shop_id=o.shop_id and p.status='succeeded' and p.paid and not p.requires_review
 and r.body->>'payment_id'=p.payment_id::text and not s.requires_review and s.status in ('unknown','pending','succeeded')
 and not q.enabled and q.attempts=1)
 or exists(select 1 from cron.job where jobname='quest-stage-subscription-settlement' and active)
 or exists(select 1 from public.billing_sandbox_refunds where order_id='${order}' and state not in ('canceled','rejected'))
 then raise exception 'recovery target denied'; end if;
end; $guard$;
`
async function query(sql) {
 const dir = await mkdtemp(join(tmpdir(), 'settlement-recovery-'))
 try {
  const file = join(dir, 'query.sql')
  await writeFile(file, sql, { mode: 0o600 })
  const { stdout } = await exec('node_modules/.bin/supabase', ['db','query','--linked','--project-ref',project,'--output','json','--file',file], { timeout:60000,maxBuffer:1024*1024 })
  return parseQueryRows(stdout)
 } finally { await rm(dir, {recursive:true,force:true}) }
}
export async function recoverStageSettlement(env, execute = query, createProvider = createSandboxHttpClient) {
 if (env.SUPABASE_PROJECT_ID !== project || env.GITHUB_REF !== 'refs/heads/staging'
  || env.GITHUB_REPOSITORY !== 'Adoms17/quest-platform' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  || env.YOOKASSA_SANDBOX_SHOP_ID !== '1467641') throw Error('recovery environment denied')
 const rows = await execute(`begin transaction read only; ${guard}
 select jsonb_build_object('shopId',o.shop_id,'body',r.body-'customer','receiptId',s.provider_receipt_id) as operation
 from public.billing_prepayment_settlements r join public.billing_sandbox_orders o on o.id=r.order_id
 join public.billing_prepayment_settlement_status s on s.order_id=o.id where o.id='${order}';`)
 if (!Array.isArray(rows) || rows.length !== 1 || rows[0].operation?.shopId !== '1467641'
  || rows[0].operation?.body?.payment_id !== payment) throw Error('recovery snapshot denied')
 // Even an accidental future call to a create method cannot send a provider POST.
 const provider = createProvider({enabled:true,shopId:'1467641',secretKey:env.YOOKASSA_SANDBOX_SECRET_KEY}, {
  fetchImpl:(url,options) => {
   if (options?.method !== 'GET') throw Error('recovery GET only')
   return fetch(url,options)
  },
 })
 const result = await provider.findSettlement(rows[0].operation)
 if (!result || !/^r[at]-[a-zA-Z0-9-]{1,100}$/.test(result.id) || result.status !== 'succeeded') throw Error('recovery not resolved')
 const saved = await execute(`begin; set local lock_timeout='5s';
 select 1 from public.billing_sandbox_orders where id='${order}' for update;
 select 1 from public.billing_sandbox_settlement_schedule where order_id='${order}' for update;
 ${guard}
 select public.record_prepayment_settlement('${order}','${result.id}','succeeded');
 commit;
 select status,provider_receipt_id,requires_review from public.billing_prepayment_settlement_status where order_id='${order}';`)
 if (saved?.length !== 1 || saved[0].status !== 'succeeded' || saved[0].provider_receipt_id !== result.id || saved[0].requires_review !== false) throw Error('recovery storage unconfirmed')
 return {status:'succeeded',receiptId:result.id}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try { console.log(JSON.stringify(await recoverStageSettlement(process.env))) }
 catch { console.error('Existing settlement recovery failed; no provider POST was allowed.'); process.exitCode=1 }
}

