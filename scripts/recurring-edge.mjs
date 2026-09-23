import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
export async function verifyRecurringEdge(container,sql,docker,serviceToken){
 const name=container+'-edge',workerToken='ab'.repeat(32)
 const fixture=readFileSync(new URL('../supabase/tests/database/billing_recurring_due.test.sql',import.meta.url),'utf8').split("select is(public.prepare_due")[0].replaceAll('recurring-','edge-recurring-').replaceAll('sandbox-edge-recurring-v2','sandbox-recurring-v2').replaceAll("'123'","'987'")
 sql('set search_path=public,extensions;'+fixture+'commit;')
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
   '-e','YOOKASSA_SANDBOX_ENABLED=true','-e','YOOKASSA_SANDBOX_RECURRING_ENABLED=true',
   '-e','YOOKASSA_SANDBOX_WORKER_TOKEN='+workerToken,
   'supabase/edge-runtime:v1.74.3','start','--main-service','/fixture']);started=true
  let ready=false
  for(let i=0;i<40;i++){try{if(request('GET').status===405){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
  if(!ready){
   const logs=docker(['logs','--tail','30',name]).replaceAll(serviceToken,'[redacted]').replaceAll(workerToken,'[redacted]')
   throw new Error('Test Edge Runtime did not become ready: '+logs)
  }
  expect(request('POST',false).status).toBe(401)
  const result=request();expect(result.status,result.body).toBe(200)
  expect(JSON.parse(result.body)).toEqual({processed:1,failed:0,reconciliationRequired:0,reviewRequired:0})
  const org="(select organization_id from public.billing_recurring_consents where id=md5('edge-recurring-source-consent')::uuid)"
  expect(sql(`select revision from public.organization_subscriptions where organization_id=${org}`).trim()).toBe('2')
  expect(sql(`select count(*) from public.billing_recurring_orders r join public.billing_period_confirmations p on p.confirmation_id=r.id where r.organization_id=${org}`).trim()).toBe('1')
  const again=request();expect(again.status).toBe(200);expect(JSON.parse(again.body).processed).toBe(0)
  expect(sql(`select revision from public.organization_subscriptions where organization_id=${org}`).trim()).toBe('2')
 }finally{if(started)docker(['rm','-f',name])}
}
