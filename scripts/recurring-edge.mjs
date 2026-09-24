import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
export async function verifyRecurringEdge(container,sql,docker,serviceToken){
 const name=container+'-edge',workerToken='ab'.repeat(32)
 const fixture=readFileSync(new URL('../supabase/tests/database/billing_recurring_due.test.sql',import.meta.url),'utf8').split("select is(public.prepare_due")[0].replaceAll('recurring-','edge-recurring-').replaceAll('sandbox-edge-recurring-v2','sandbox-recurring-v2').replaceAll("'123'","'987'")
 sql('set search_path=public,extensions;'+fixture+'commit;')
 const scopedOrg=sql("select organization_id from public.billing_recurring_consents where id=md5('edge-recurring-source-consent')::uuid" ).trim()
 let started=false
 const request=(method='POST',authorized=true)=>{
  const args=['exec',container,'curl','-sS','--max-time','15','-w','\n%{http_code}','-X',method]
  if(authorized)args.push('-H','x-qvesta-worker-token: '+workerToken)
  args.push('http://127.0.0.1:9000')
  const output=docker(args),cut=output.lastIndexOf('\n')
  return {status:Number(output.slice(cut+1)),body:output.slice(0,cut)}
 }
 try{
  docker(['run','-d','--name',name,'--network','container:'+container,
   '--mount',`type=bind,source=${fileURLToPath(new URL('../supabase/functions',import.meta.url))},target=/functions,readonly`,
   '--mount',`type=bind,source=${fileURLToPath(new URL('./fixtures/recurring-edge',import.meta.url))},target=/fixture,readonly`,
   '-e','SUPABASE_URL=http://127.0.0.1:3000','-e','SUPABASE_SERVICE_ROLE_KEY='+serviceToken,
   '-e','YOOKASSA_SANDBOX_SHOP_ID=987','-e','YOOKASSA_SANDBOX_SECRET_KEY=synthetic-value',
   '-e','YOOKASSA_SANDBOX_RECURRING_ORGANIZATION_ID='+scopedOrg,
   '-e','YOOKASSA_SANDBOX_ENABLED=true','-e','YOOKASSA_SANDBOX_RECURRING_ENABLED=true',
   '-e','YOOKASSA_SANDBOX_WORKER_TOKEN='+workerToken,
   '-e','QVESTA_TEST_LOST_PAYMENT_RESPONSE=1',
   'supabase/edge-runtime:v1.74.3','start','--main-service','/fixture']);started=true
  // Холодная загрузка npm-зависимостей имеет отдельный ограниченный бюджет.
  const startupDeadline=Date.now()+180000
  let ready=false
  while(Date.now()<startupDeadline){try{if(request('GET').status===405){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
  if(!ready){
   const logs=docker(['logs','--tail','30',name]).replaceAll(serviceToken,'[redacted]').replaceAll(workerToken,'[redacted]')
   const state=docker(['inspect','--format','{{.State.Status}} exit={{.State.ExitCode}}',name])
   throw new Error('Test Edge Runtime did not become ready within 180s ('+state+'): '+logs)
  }
  expect(request('POST',false).status).toBe(401)
  const result=request();expect(result.status,result.body).toBe(200)
  expect(JSON.parse(result.body)).toEqual({processed:1,failed:0,reconciliationRequired:1,reviewRequired:0})
  const org="(select organization_id from public.billing_recurring_consents where id=md5('edge-recurring-source-consent')::uuid)"
  const orders=`select id from public.billing_recurring_orders where organization_id=${org}`
  expect(sql(`select revision from public.organization_subscriptions where organization_id=${org}`).trim()).toBe('1')
  expect(sql(`select count(*) from public.billing_period_confirmations where confirmation_id in (${orders})`).trim()).toBe('0')
  expect(sql(`select count(*) from public.billing_recurring_results where order_id in (${orders})`).trim()).toBe('0')
  expect(sql(`select count(*) from public.billing_discount_reservations where order_id in (${orders}) and state='reserved'`).trim()).toBe('1')
  const paused=request();expect(paused.status).toBe(200)
  expect(JSON.parse(paused.body)).toEqual({processed:0,failed:0,reconciliationRequired:0,reviewRequired:0})
  // Advance only the synthetic fixture's retry time; no production clock or endpoint changes.
  sql(`update public.billing_recurring_checks set next_check_at=now()-interval '1 second' where order_id in (${orders})`)
  const recovered=request();expect(recovered.status,recovered.body).toBe(200)
  expect(JSON.parse(recovered.body)).toEqual({processed:1,failed:0,reconciliationRequired:0,reviewRequired:0})
  expect(sql(`select count(*) from public.billing_recurring_dispatches where order_id in (${orders})`).trim()).toBe('1')
  expect(sql(`select count(*) from public.billing_recurring_results where order_id in (${orders}) and status='succeeded' and paid and not requires_review`).trim()).toBe('1')
  expect(sql(`select revision from public.organization_subscriptions where organization_id=${org}`).trim()).toBe('2')
  expect(sql(`select count(*) from public.billing_recurring_orders r join public.billing_period_confirmations p on p.confirmation_id=r.id where r.organization_id=${org}`).trim()).toBe('1')
  const again=request();expect(again.status).toBe(200);expect(JSON.parse(again.body).processed).toBe(0)
  expect(sql(`select revision from public.organization_subscriptions where organization_id=${org}`).trim()).toBe('2')
 }finally{if(started)docker(['rm','-f',name])}
}
