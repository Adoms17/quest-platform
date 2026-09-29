import {pathToFileURL} from 'node:url'
import {writeFileSync} from 'node:fs'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function fiscalTargetCheck(orderId){
 if(typeof orderId!=='string'||!uuid.test(orderId))throw Error('invalid_order_id')
 return `begin transaction read only;
do $guard$
begin
 if not exists (
  select 1 from public.billing_fiscal_acceptance_fixtures f
  join public.billing_sandbox_orders o on o.id=f.order_id and o.organization_id=f.organization_id
  join public.billing_sandbox_payment_results p on p.order_id=o.id
  where f.id='b504e302-e2c8-9b96-edb0-8ff83476a935'
   and f.organization_id='dcc2e33b-108a-d22f-7409-162fa76447f3'
   and o.id='${orderId}' and o.shop_id='1467641' and o.amount_minor=99000
   and p.status='succeeded' and p.paid and p.shop_id=o.shop_id and not p.requires_review
 ) then raise exception 'fiscal acceptance target denied'; end if;
end; $guard$;
rollback;
`
}
export async function runStageFiscalOrder(token,{dispatch=false,orderId}={},fetcher=fetch){
 if(!/^[a-f0-9]{64}$/.test(token??''))throw Error('worker_token_missing_or_invalid')
 fiscalTargetCheck(orderId)
 if(typeof dispatch!=='boolean')throw Error('invalid_dispatch')
 const r=await fetcher('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-subscription-fiscal-order',{
  method:'POST',redirect:'error',headers:{'x-qvesta-worker-token':token,'x-qvesta-order-id':orderId,'x-qvesta-fiscal-mode':dispatch?'dispatch':'reconcile'},signal:AbortSignal.timeout(45000)})
 if(!r.ok)throw Error('worker_http_failure')
 const data=await r.json(),keys=['checked','failed','unresolved','dispatched']
 if(!keys.every(k=>Number.isSafeInteger(data?.[k])&&data[k]>=0)
  ||data.dispatched>1||(!dispatch&&data.dispatched!==0))throw Error('worker_invalid_response')
 if(data.failed||data.unresolved)throw Error('worker_requires_attention')
 return Object.fromEntries(keys.map(k=>[k,data[k]]))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv[2]==='--preflight'&&process.argv.length===4)writeFileSync(process.argv[3],fiscalTargetCheck(process.env.SANDBOX_ORDER_ID))
  else if(process.argv.length===2)console.log(JSON.stringify(await runStageFiscalOrder(process.env.YOOKASSA_SANDBOX_WORKER_TOKEN,{dispatch:process.env.FISCAL_DISPATCH==='true',orderId:process.env.SANDBOX_ORDER_ID})))
  else throw Error('invalid_arguments')
 }catch{console.error('Stage fiscal acceptance failed; inspect protected diagnostics. No automatic retry.');process.exitCode=1}
}
