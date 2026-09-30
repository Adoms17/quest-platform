// @vitest-environment node
import { test, expect } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const id='11111111-1111-4111-8111-111111111111', token='ab'.repeat(32)
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000});if(r.status!==0)throw Error(r.stderr);return (args[0]==='logs'?r.stdout+r.stderr:r.stdout).trim()}
test.skipIf(process.env.QVESTA_TEST_SETTLEMENT_EDGE!=='1')('enabled settlement runtime recovers lost response without second send',async()=>{
 const name='qvesta-settlement-edge-'+randomUUID().replaceAll('-','');let started=false
 try {
  docker(['run','-d','--name',name,'-p','127.0.0.1::9000',
   '--mount',`type=bind,source=${fileURLToPath(new URL('../supabase/functions',import.meta.url))},target=/functions,readonly`,
   '--mount',`type=bind,source=${fileURLToPath(new URL('./fixtures/subscription-settlement-edge',import.meta.url))},target=/fixture,readonly`,
   'supabase/edge-runtime:v1.74.3','start','--main-service','/fixture']);started=true
  const address=docker(['port',name,'9000']);if(!/^127\.0\.0\.1:\d+$/.test(address))throw Error('invalid address')
  const url='http://'+address
  let ready=false
  for(let i=0;i<100;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status===405){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,300))}
  if(!ready)throw Error('Edge startup: '+docker(['logs','--tail','20',name]))
  const request=(target=id,purpose='qvesta-order-settlement-v1')=>{
   const timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',token).update(`${purpose}\n${target}\n${timestamp}`).digest('hex')
   return fetch(url,{method:'POST',headers:{'x-qvesta-order-id':target,'x-qvesta-order-timestamp':timestamp,'x-qvesta-order-signature':signature},signal:AbortSignal.timeout(5000)})
  }
  expect((await request(id,'qvesta-order-reconcile-v1')).status).toBe(401)
  expect((await request('22222222-2222-4222-8222-222222222222')).status).toBe(503)
  expect((await request()).status).toBe(503) // lost response, claim already consumed
  const recovered=await request();expect(recovered.status).toBe(200)
  expect(recovered.headers.get('cache-control')).toBe('no-store')
  expect(await recovered.json()).toEqual({state:'succeeded'})
  const repeat=await request();expect(repeat.status).toBe(200)
  expect(await repeat.json()).toEqual({state:'succeeded'})
 }finally{if(started)docker(['rm','-f',name])}
},90000)
