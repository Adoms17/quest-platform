// @vitest-environment node
import {test,expect,vi} from 'vitest'
import {verifyDisabledFiscalRefund as run} from './verify-disabled-fiscal-refund.mjs'
const config={projectId:'jeugfyaqzfgdvfhdxfht',token:'synthetic.jwt.signature'}
const response=(status=503,body={error:'sandbox_disabled'},headers={})=>new Response(JSON.stringify(body),{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'https://stage-admin.qvesta.ru',...headers}})
test('only empty payload to fixed stage endpoint; redirects forbidden',async()=>{
 const fetchImpl=vi.fn(async()=>response());await run({...config,fetchImpl})
 expect(fetchImpl).toHaveBeenCalledTimes(1)
 expect(fetchImpl).toHaveBeenCalledWith('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/admin-subscription-fiscal-refund',expect.objectContaining({method:'POST',body:'{}',redirect:'error',headers:expect.objectContaining({Authorization:'Bearer synthetic.jwt.signature'})}))
})
test.each([{projectId:'production'},{token:''},{token:'bad\r\nheader'}])('rejects invalid configuration before network',async change=>{
 const fetchImpl=vi.fn();await expect(run({...config,...change,fetchImpl})).rejects.toThrow('Invalid smoke configuration');expect(fetchImpl).not.toHaveBeenCalled()
})
test.each([401,400,200,500])('rejects status %i without retry',async status=>{
 const fetchImpl=vi.fn(async()=>response(status));await expect(run({...config,fetchImpl})).rejects.toThrow('Disabled fiscal refund smoke failed');expect(fetchImpl).toHaveBeenCalledTimes(1)
})
test.each([
 ()=>response(503,{error:'other'}),()=>response(503,{error:'sandbox_disabled',extra:'private'}),
 ()=>response(503,undefined,{'Cache-Control':'public'}),()=>response(503,undefined,{'Access-Control-Allow-Origin':'*'}),
 ()=>new Response('private',{status:503}),()=>{throw Error('private-token')},
])('rejects invalid response or network failure with safe error',async make=>{
 await expect(run({...config,fetchImpl:async()=>make()})).rejects.toThrow(/^Disabled fiscal refund smoke failed$/)
})
