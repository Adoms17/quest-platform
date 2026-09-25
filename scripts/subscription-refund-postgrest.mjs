import { verifySubscriptionRefundEdge } from './subscription-refund-edge.mjs'
import { spawnSync } from 'node:child_process'
import { randomBytes, createHmac } from 'node:crypto'
import { expect } from 'vitest'
import { verifySubscriptionRefundHttpDatabase } from './subscription-refund-http-database.mjs'
export async function verifySubscriptionRefundPostgrest(container,sql){
 if(!/^qvesta-release-test-[a-f0-9]{32}$/.test(container))throw Error('isolated database required')
 const name=container+'-refund-rest',secret=randomBytes(32).toString('hex')
 const docker=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:15000});if(r.status!==0)throw Error('isolated refund REST command failed');return (r.stdout+(args[0]==='logs'?r.stderr:'')).trim()}
 const token=role=>{const body=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
 const request=(role,rpc,args)=>{
  const output=docker(['exec','-i',container,'curl','-sS','--max-time','5','-w','\n%{http_code}','-H','Content-Type: application/json','-H','Authorization: Bearer '+token(role),'--data-binary','@-','http://127.0.0.1:3000/rpc/'+rpc],JSON.stringify(args))
  const cut=output.lastIndexOf('\n');return {status:Number(output.slice(cut+1)),data:JSON.parse(output.slice(0,cut))}
 }
 let started=false
 try{
  docker(['run','-d','--name',name,'--network','container:'+container,'-e','PGRST_DB_URI=postgres://postgres@127.0.0.1:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,'postgrest/postgrest:v16.1']);started=true
  const args={p_actor_user_id:null,p_mfa_at:null,p_expires_at:null,p_action:'read',p_refund_id:null}
  let ready=false
  for(let i=0;i<30;i++){try{if(request('authenticated','subscription_refund_from_gateway',args).status===403){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}
  expect(ready).toBe(true)
  expect(request('anon','subscription_refund_from_gateway',args).status).toBe(401)
  await verifySubscriptionRefundHttpDatabase(sql,{rpc:async(name,args)=>{
   const response=request('service_role',name,args)
   expect(response.status,JSON.stringify(response.data)).toBe(200)
   return {data:response.data}
  }})
  await verifySubscriptionRefundEdge(container,sql,docker,token('service_role'),secret)
 }finally{if(started)docker(['rm','-f',name])}
}
