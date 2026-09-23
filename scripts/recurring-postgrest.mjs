import { spawnSync } from 'node:child_process'
import { randomBytes, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { verifyRecurringEdge } from './recurring-edge.mjs'
import { expect } from 'vitest'
export async function verifyRecurringPostgrest(container,sql){
 if(!/^qvesta-release-test-[a-f0-9]{32}$/.test(container))throw Error('isolated database required')
 const name=container+'-rest',secret=randomBytes(32).toString('hex')
 const docker=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:15000});if(r.status!==0)throw Error('isolated PostgREST command failed');return r.stdout.trim()}
 const token=role=>{const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');const body=header+'.'+payload;return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
 const request=(role,action,extra={})=>{
  const output=docker(['exec','-i',container,'curl','-sS','--max-time','5','-w','\n%{http_code}','-H','Content-Type: application/json','-H','Authorization: Bearer '+token(role),'--data-binary','@-','http://127.0.0.1:3000/rpc/sandbox_recurring_worker_command'],JSON.stringify({p_order_id:id,p_action:action,...extra}))
  const cut=output.lastIndexOf('\n');return {status:Number(output.slice(cut+1)),data:JSON.parse(output.slice(0,cut))}
 }
 const fixture=readFileSync(new URL('../supabase/tests/database/billing_recurring_server.test.sql',import.meta.url),'utf8').split("select set_config('test.attempt'")[0].replaceAll('recurring-','http-recurring-').replaceAll('sandbox-http-recurring-v2','sandbox-recurring-v2')
 sql('set search_path=public,extensions;'+fixture+'commit;')
 const id=sql("select id from public.billing_recurring_orders where source_order_id=md5('http-recurring-source-order')::uuid").trim()
 let started=false
 try{
  docker(['run','-d','--name',name,'--network','container:'+container,'-e','PGRST_DB_URI=postgres://postgres@127.0.0.1:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,'postgrest/postgrest:v16.1']);started=true
  let ready=false
  for(let i=0;i<30;i++){try{if(request('authenticated','read').status===403){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}
  expect(ready).toBe(true)
  expect(request('anon','read').status).toBe(401)
  const begun=request('service_role','begin');expect(begun.status).toBe(200);expect(begun.data.state).toBe('prepared')
  const read=request('service_role','read');expect(read.status).toBe(200);expect(read.data.id).toBe(id)
  expect(request('service_role','claim',{p_key:read.data.idempotencyKey}).data.authorized).toBe(true)
  expect(request('service_role','claim',{p_key:read.data.idempotencyKey}).data.authorized).toBe(false)
  const paymentId='55555555-5555-4555-8555-555555555555'
  expect(request('service_role','record',{p_payment:{paymentId,status:'pending',paid:false,test:true}}).status).toBe(200)
  expect(request('service_role','read').data.providerPaymentId).toBe(paymentId)
  expect(request('authenticated','claim',{p_key:read.data.idempotencyKey}).status).toBe(403)
  await verifyRecurringEdge(container,sql,docker,token('service_role'))
 }finally{if(started)docker(['rm','-f',name])}
}
