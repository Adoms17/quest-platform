// @vitest-environment node
import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const enabled=process.env.QVESTA_TEST_SUBSCRIPTION_REFUND==='1'
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000});if(r.status!==0)throw Error('isolated runtime command failed');return r.stdout.trim()}
test.skipIf(!enabled).each(['admin-subscription-refund','admin-subscription-refund-prepare'])('%s loads in Edge Runtime and remains disabled',async endpoint=>{
 const name='qvesta-refund-runtime-'+randomUUID().replaceAll('-','');let created=false
 try{
  docker(['run','-d','--name',name,'-p','127.0.0.1::9000','--mount',`type=bind,source=${fileURLToPath(new URL('../supabase/functions',import.meta.url))},target=/functions,readonly`,'supabase/edge-runtime:v1.74.3','start','--main-service','/functions/'+endpoint]);created=true
  const address=docker(['port',name,'9000']);if(!/^127\.0\.0\.1:\d+$/.test(address))throw Error('unexpected address')
  const url='http://'+address;let ready=false
  for(let i=0;i<30;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status===405){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
  expect(ready).toBe(true)
  const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(5000)})
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'sandbox_disabled'})
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await fetch(url,{method:'POST',headers:{origin:'https://untrusted.test'},signal:AbortSignal.timeout(5000)})).status).toBe(403)
 }finally{if(created)docker(['rm','-f',name])}
},90000)
