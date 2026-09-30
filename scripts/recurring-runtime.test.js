// @vitest-environment node
import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const enabled=process.env.QVESTA_TEST_RECURRING_RUNTIME==='1'
function docker(args){
 const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000})
 if(result.status!==0)throw Error('isolated runtime Docker command failed')
 return (args[0]==='logs'?result.stdout+result.stderr:result.stdout).trim()
}
test.skipIf(!enabled).each(['sandbox-recurring','sandbox-reconcile','admin-subscription-fiscal-refund','sandbox-subscription-fiscal-order','sandbox-subscription-settlement-order','admin-fiscal-acceptance-prepare'])('%s loads in Edge Runtime and fails closed',async endpoint=>{
 const name='qvesta-recurring-runtime-'+randomUUID().replaceAll('-','')
 const token='ab'.repeat(32)
 let created=false
 try{
  docker(['run','-d','--name',name,'-p','127.0.0.1::9000','--mount',`type=bind,source=${fileURLToPath(new URL('../supabase/functions',import.meta.url))},target=/functions,readonly`,'-e',`YOOKASSA_SANDBOX_WORKER_TOKEN=${token}`,'supabase/edge-runtime:v1.74.3','start','--main-service',`/functions/${endpoint}`])
  created=true
  const address=docker(['port',name,'9000'])
  if(!/^127\.0\.0\.1:\d+$/.test(address))throw Error('unexpected runtime address')
  const url='http://'+address
  let ready=false
  const deadline=Date.now()+60000
  for(;Date.now()<deadline;){
   try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status===405){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,500))
  }
  if(!ready)throw Error('Edge Runtime startup timed out: '+docker(['logs','--tail','25',name]).replaceAll(token,'[synthetic-token]'))
  if(endpoint.startsWith('admin-')){
   const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(5000)})
   expect(response.status).toBe(503)
   expect(response.headers.get('cache-control')).toBe('no-store')
   expect(await response.json()).toEqual({error:'sandbox_disabled'})
   return
  }
  for(const [method,headers,status] of [
   ['GET',{},405],['POST',{},401],
   ['POST',{'x-qvesta-worker-token':'cd'.repeat(32)},401],
   ['POST',{'x-qvesta-worker-token':token},503],
  ]){
   const response=await fetch(url,{method,headers,signal:AbortSignal.timeout(5000)})
   expect(response.status).toBe(status)
   expect(response.headers.get('cache-control')).toBe('no-store')
   expect(await response.text()).toBe('')
  }
 }finally{if(created)docker(['rm','-f',name])}
},120000)
