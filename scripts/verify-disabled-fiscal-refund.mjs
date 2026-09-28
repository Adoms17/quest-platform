import { pathToFileURL } from 'node:url'
const stage='jeugfyaqzfgdvfhdxfht'
export async function verifyDisabledFiscalRefund({projectId,token,fetchImpl=fetch}){
 if(projectId!==stage||typeof token!=='string'||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))throw Error('Invalid smoke configuration')
 try{
  const response=await fetchImpl(`https://${stage}.supabase.co/functions/v1/admin-subscription-fiscal-refund`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:'https://stage-admin.qvesta.ru'},
   body:'{}',redirect:'error',signal:AbortSignal.timeout(15000),
  })
  if(response.status!==503||response.headers.get('cache-control')!=='no-store'
   ||response.headers.get('access-control-allow-origin')!=='https://stage-admin.qvesta.ru')throw Error('Unexpected response')
  const body=await response.json()
  if(body?.error!=='sandbox_disabled'||Object.keys(body).length!==1)throw Error('Unexpected response')
 }catch{throw Error('Disabled fiscal refund smoke failed')}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  await verifyDisabledFiscalRefund({projectId:process.env.SUPABASE_PROJECT_ID,token:process.env.QVESTA_SMOKE_JWT})
  console.log('Disabled fiscal refund smoke PASS: POST 503 sandbox_disabled, no-store, expected CORS')
 }catch{console.error('Disabled fiscal refund smoke failed; no credentials or response details logged');process.exitCode=1}
}
