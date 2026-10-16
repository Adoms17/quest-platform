import { checkLocalToolOptions, localExecutable, requireLocalConfig } from './local-tool-options.mjs'
checkLocalToolOptions('renewal', process.argv.slice(2))
// Только явное sandbox-продление ранее оплаченной синтетической организации.
// node --env-file=yookassa-sandbox.local scripts/prepare-local-sandbox-renewal.mjs <paid order UUID> [100|1000] --execute
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const source=process.argv[2]
const amountMinor=Number(process.argv[3]==='--execute'?100:process.argv[3])
if(![100,1000].includes(amountMinor))throw Error('Only fixed synthetic test amounts')
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source??'')||process.env.YOOKASSA_SANDBOX_ENABLED!=='true')throw Error('Explicit sandbox source required')
function command(file,args,input){return new Promise((resolve,reject)=>{
 const p=spawn(file,args,{shell:file.endsWith('.cmd'),windowsHide:true});let out=''
 p.stdout.on('data',d=>out+=d);p.stderr.resume();p.on('error',()=>reject(Error('local command failed')))
 p.on('close',c=>c===0?resolve(out.trim()):reject(Error('local command failed')));p.stdin.end(input)
})}
const sql=q=>command('docker',['exec','-i','supabase_db_quest-platform','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],q)
try {
 const raw=await command(localExecutable('npx'),['supabase','status','--output','json']);const config=JSON.parse(raw.slice(raw.indexOf('{')))
 requireLocalConfig(config)
 const shop=process.env.YOOKASSA_SANDBOX_SHOP_ID;if(!/^\d+$/.test(shop??''))throw Error()
 const fixture=JSON.parse(await sql(`select jsonb_build_object('actor',o.actor_id,'org',o.organization_id) from public.billing_sandbox_orders o join auth.users u on u.id=o.actor_id join public.billing_period_confirmations c on c.confirmation_id=o.id where o.id='${source}' and o.shop_id='${shop}' and u.email=u.id::text||'@example.test' and o.amount_minor=100;`))
 const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const auth=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const link=await admin.auth.admin.generateLink({type:'magiclink',email:fixture.actor+'@example.test'})
 if(link.error)throw Error()
 const login=await auth.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:link.data.properties.verification_type})
 if(login.error)throw Error()
 // Повтор скрипта восстанавливает единственный незавершённый заказ.
 const pending=await auth.rpc('find_pending_sandbox_order',{p_organization_id:fixture.org});if(pending.error)throw Error()
 let orderId=pending.data
 if(!orderId){
 const out=await sql(`begin; select set_config('request.jwt.claim.sub','${fixture.actor}',true);
 select public.reserve_sandbox_payment_order(s.organization_id,'${randomUUID()}',s.revision,s.plan_version_id,${amountMinor},'${shop}','https://stage.qvesta.ru/organization/billing',s.period_start,s.period_end+interval '1 day')->>'id' from public.organization_subscriptions s where s.organization_id='${fixture.org}' and s.status='active' and s.period_start<=clock_timestamp() and s.period_end>clock_timestamp(); commit;`)
 orderId=out.split(/\r?\n/).at(-1)
 }
 if(!/^[0-9a-f-]{36}$/.test(orderId??''))throw Error()
 const response=await fetch(config.API_URL+'/functions/v1/sandbox-checkout',{method:'POST',headers:{Authorization:'Bearer '+login.data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({orderId})})
 if(!response.ok)throw Error()
 const result=await response.json()
 console.log(JSON.stringify({orderId,status:result.status,confirmationUrl:result.confirmationUrl}))
 admin.auth.stopAutoRefresh();auth.auth.stopAutoRefresh()
}catch{console.error('local_sandbox_renewal_failed');process.exitCode=1}
