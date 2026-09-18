import { checkLocalToolOptions } from './local-tool-options.mjs'
checkLocalToolOptions('refund', process.argv.slice(2))
// Только синтетический sandbox, без изменения подписки. Без --execute только preview.
// node --env-file=yookassa-sandbox.local scripts/run-local-sandbox-refund.mjs <order UUID> <копейки> <command UUID> [--execute]
import { spawn } from 'node:child_process'
import { createSandboxHttpClient } from '../supabase/functions/_shared/yookassaSandboxHttp.js'
import { runSandboxRefund } from '../supabase/functions/_shared/sandboxRefund.js'
const [orderId,amountText,commandId]=process.argv.slice(2), amount=Number(amountText)
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if(!uuid.test(orderId??'')||!uuid.test(commandId??'')||!Number.isSafeInteger(amount)||amount<=0||process.env.YOOKASSA_SANDBOX_ENABLED!=='true')throw Error('Explicit sandbox refund required')
function sql(query){return new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i','supabase_db_quest-platform','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});let out=''
 p.stdout.on('data',d=>out+=d);p.stderr.resume();p.on('error',()=>reject(Error('local database unavailable')))
 p.on('close',code=>code===0?resolve(out.trim()):reject(Error('local database rejected refund')));p.stdin.end(query)
})}
try {
 const shopId=process.env.YOOKASSA_SANDBOX_SHOP_ID;if(!/^\d+$/.test(shopId??''))throw Error()
 const actor=await sql(`select o.actor_id from public.billing_sandbox_orders o join auth.users u on u.id=o.actor_id where o.id='${orderId}' and o.shop_id='${shopId}' and o.amount_minor in (100,1000) and u.email=u.id::text||'@example.test';`)
 if(!uuid.test(actor))throw Error()
 // Предпросмотр полностью откатывает временный допуск оператора.
 if(!process.argv.includes('--execute')) {
  const raw=await sql(`begin; insert into public.billing_sandbox_refund_operators values('${actor}') on conflict do nothing;
   set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true);
   select public.preview_sandbox_refund('${orderId}'); rollback;`)
  const preview=JSON.parse(raw.split(/\r?\n/).at(-1))
  console.log(JSON.stringify({check:'refund_preview',amountMinor:amount,availableMinor:preview.available_minor,accessEffect:preview.access_effect,environment:preview.environment}))
  process.exit(0)
 }
 // Допуск только выделенного синтетического оператора в локальной БД теста.
 await sql(`insert into public.billing_sandbox_refund_operators values('${actor}') on conflict do nothing;`)
 async function invoke(expression){const raw=await sql(`begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true); select ${expression}; commit;`);return JSON.parse(raw.split(/\r?\n/).at(-1))}
 const preview=await invoke(`public.preview_sandbox_refund('${orderId}')`)
 console.log(JSON.stringify({check:'refund_preview',amountMinor:amount,availableMinor:preview.available_minor,accessEffect:preview.access_effect,environment:preview.environment}))
 if(!process.argv.includes('--execute'))process.exit(0)
 const refundId=await invoke(`to_jsonb(public.reserve_sandbox_refund('${orderId}','${commandId}',${amount}))`)
 const rpc=async(name,args)=>{
  const allowed=['read_sandbox_refund','begin_sandbox_refund','record_sandbox_refund','reject_sandbox_refund']
  if(!allowed.includes(name)||args.p_refund_id!==refundId)throw Error('invalid operation')
  let extra=''
  if(name==='record_sandbox_refund'){
   if(!uuid.test(args.p_provider_id)||!['pending','succeeded','canceled'].includes(args.p_status))throw Error('invalid result')
   extra=`, '${args.p_provider_id}', '${args.p_status}'`
  }
  return {data:await invoke(`public.${name}('${refundId}'${extra})`)}
 }
 const provider=createSandboxHttpClient({enabled:true,shopId,secretKey:process.env.YOOKASSA_SANDBOX_SECRET_KEY})
 const before=await sql(`select to_jsonb(s) from public.organization_subscriptions s join public.billing_sandbox_orders o on o.organization_id=s.organization_id where o.id='${orderId}';`)
 const result=await runSandboxRefund(refundId,{rpc,provider})
 const after=await sql(`select to_jsonb(s) from public.organization_subscriptions s join public.billing_sandbox_orders o on o.organization_id=s.organization_id where o.id='${orderId}';`)
 console.log(JSON.stringify({check:'live_refund',refundId:result.id,state:result.state,subscriptionUnchanged:before===after}))
 if(before!==after||result.state!=='succeeded')process.exitCode=1
 if(result.state==='succeeded'){
  const codes=await Promise.all([1,2,3].map(()=>fetch('http://127.0.0.1:54321/functions/v1/yookassa-sandbox-webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'notification',event:'refund.succeeded',object:{id:result.provider_refund_id,status:'canceled',amount:{value:'999.00',currency:'USD'}}})}).then(r=>r.status)))
  const afterWebhook=await sql(`select to_jsonb(s) from public.organization_subscriptions s join public.billing_sandbox_orders o on o.organization_id=s.organization_id where o.id='${orderId}';`)
  console.log(JSON.stringify({check:'refund_webhook',http:codes,subscriptionUnchanged:before===afterWebhook}))
  if(!codes.every(c=>c===200)||before!==afterWebhook)process.exitCode=1
 }
}catch{console.error('local_sandbox_refund_failed');process.exitCode=1}
