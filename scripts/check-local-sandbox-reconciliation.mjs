// Только локальный стенд и ранее оплаченный синтетический sandbox-заказ.
// node --env-file=yookassa-sandbox.local scripts/check-local-sandbox-reconciliation.mjs <order UUID>
import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { createSandboxHttpClient } from '../supabase/functions/_shared/yookassaSandboxHttp.js'
import { createSandboxReconciler, createSandboxWebhookHandler } from '../supabase/functions/_shared/sandboxReconciliation.js'
const orderId=process.argv[2]
const workerToken=process.env.YOOKASSA_SANDBOX_WORKER_TOKEN
if(!/^[a-f0-9]{64}$/.test(workerToken??''))throw Error('Sandbox worker token required')
if(!/^[0-9a-f-]{36}$/i.test(orderId??'') || process.env.YOOKASSA_SANDBOX_ENABLED!=='true')throw Error('Explicit sandbox order required')
function command(file,args,input) {
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{shell:file.endsWith('.cmd'),windowsHide:true})
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.resume()
  child.on('error',()=>reject(Error('local command failed')))
  child.on('close',code=>code===0?resolve(output.trim()):reject(Error('local command failed')))
  child.stdin.end(input)
 })
}
const sql=q=>command('docker',['exec','-i','supabase_db_quest-platform','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],q)
try {
 const raw=await command('npx.cmd',['supabase','status','--output','json'])
 const config=JSON.parse(raw.slice(raw.indexOf('{')))
 if(config.API_URL!=='http://127.0.0.1:54321')throw Error()
 const db=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const shopId=process.env.YOOKASSA_SANDBOX_SHOP_ID
 const {data:order,error}=await db.rpc('read_sandbox_reconciliation_order',{p_shop_id:shopId,p_order_id:orderId,p_payment_id:null})
 if(error||!order)throw Error()
 const provider=createSandboxHttpClient({enabled:true,shopId,secretKey:process.env.YOOKASSA_SANDBOX_SECRET_KEY})
 const payment=await provider.readPayment(order)
 if(payment.status!=='succeeded'||!payment.test||!payment.paid)throw Error()
 const recovered=await provider.findPayment({...order,providerPaymentId:null})
 if(recovered?.paymentId!==payment.paymentId)throw Error()
 console.log(JSON.stringify({check:'live_missing_payment_id_recovery',pass:true}))
 const scope=await sql(`with eligible as (
 select o.organization_id from public.billing_sandbox_orders o join auth.users u on u.id=o.actor_id
 where o.id='${orderId}' and u.email=u.id::text||'@example.test' and o.amount_minor in (100,1000)
 ), inserted as (insert into public.billing_sandbox_application_scope select organization_id from eligible on conflict do nothing returning organization_id)
 select count(*) from eligible;`)
 if(scope!=='1')throw Error()
 const endpoint=config.API_URL+'/functions/v1/yookassa-sandbox-webhook'
 const nodeMode=process.argv.includes('--node-handler')
 const worker=createSandboxReconciler({rpc:db.rpc.bind(db),provider,shopId})
 const handler=createSandboxWebhookHandler({enabled:true,reconcile:worker.webhook})
 const send=(url,options)=>nodeMode?handler(new Request(url,options)):fetch(url,options)
 const codes=await Promise.all(['payment.succeeded','payment.succeeded','payment.canceled','payment.waiting_for_capture'].map(event=>send(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'notification',event,object:{id:payment.paymentId,status:'canceled',paid:false,amount:{value:'999999.00',currency:'USD'},metadata:{order_id:orderId}}})}).then(r=>r.status)))
 const state=JSON.parse(await sql(`select jsonb_build_object('status',s.status,'receipts',(select count(*) from public.billing_period_confirmations where confirmation_id=o.id),'fulfillment',f.state,'events',(select count(*) from public.billing_sandbox_events where order_id=o.id)) from public.billing_sandbox_orders o join public.organization_subscriptions s on s.organization_id=o.organization_id join public.billing_sandbox_fulfillments f on f.order_id=o.id where o.id='${orderId}';`))
 console.log(JSON.stringify({check:'live_webhook',runtime:nodeMode?'node-handler':'edge',http:codes,...state,pass:codes.every(c=>c===200)&&state.status==='active'&&state.receipts===1&&state.fulfillment==='applied'}))
 if(!codes.every(c=>c===200)||state.status!=='active'||state.receipts!==1||state.fulfillment!=='applied')process.exitCode=1
 const denied=await fetch(config.API_URL+'/functions/v1/sandbox-reconcile',{method:'POST'})
 const reconciled=await fetch(config.API_URL+'/functions/v1/sandbox-reconcile',{method:'POST',headers:{'x-qvesta-worker-token':workerToken}})
 const batch=reconciled.ok?await reconciled.json():{}
 console.log(JSON.stringify({check:'live_reconciliation',anonymousStatus:denied.status,workerStatus:reconciled.status,...batch}))
 if(denied.status!==401||reconciled.status!==200||batch.failed>0||batch.refunds?.failed>0)process.exitCode=1
 if(nodeMode)console.log(JSON.stringify({check:'node_reconciliation',...await worker.batch()}))
 db.auth.stopAutoRefresh()
} catch { console.log('local_sandbox_reconciliation_failed');process.exitCode=1 }
