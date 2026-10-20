// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {createFiscalAcceptanceEndpoint,createFiscalAcceptanceRuntime} from './fiscalAcceptanceEndpoint.js'
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
function setup(){
 const epoch=Math.floor(Date.now()/1000)
 const claims={sub:id(1),role:'authenticated',aal:'aal2',exp:epoch+600,amr:[{method:'totp',timestamp:epoch}]}
 const auth={getClaims:vi.fn(async()=>({data:{claims}})),getUser:vi.fn(async()=>({data:{user:{id:id(1)}}}))}
 const data={fixtureId:id(2),orderId:id(3),organizationId:id(4),amountMinor:99000,periodStart:'2026-09-28T10:00:00Z',periodEnd:'2026-09-28T10:30:00Z',shopId:'1467641',environment:'sandbox',email:'hidden@example.test'}
 const service={rpc:vi.fn(async()=>({data}))}
 const options={enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],auth,service}
 const request=(body={fixtureId:id(2),email:'synthetic@example.test'},headers={})=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://stage-admin.qvesta.ru',...headers},body:JSON.stringify(body)})
 return {epoch,claims,auth,data,service,options,request,handler:createFiscalAcceptanceEndpoint(options)}
}
it('passes only verified identity and fixed request fields; omits contact from response',async()=>{
 const s=setup(),r=await s.handler(s.request())
 expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store')
 expect(s.service.rpc).toHaveBeenCalledExactlyOnceWith('prepare_fiscal_acceptance_from_gateway',{p_actor_user_id:id(1),p_mfa_at:s.epoch,p_expires_at:s.epoch+600,p_fixture_id:id(2),p_email:'synthetic@example.test'})
 expect(await r.json()).not.toHaveProperty('email')
})
it.each(['organizationId','amountMinor','periodEnd','actorId','mfaAt'])('rejects injected %s before RPC',async field=>{
 const s=setup();expect((await s.handler(s.request({fixtureId:id(2),email:'synthetic@example.test',[field]:'injected'}))).status).toBe(400);expect(s.service.rpc).not.toHaveBeenCalled()
})
it.each(['stale','expired','aal1','revoked','mismatch','signature'])('rejects %s identity before RPC',async mode=>{
 const s=setup()
 if(mode==='stale')s.claims.amr[0].timestamp-=301
 if(mode==='expired')s.claims.exp=s.epoch-1
 if(mode==='aal1')s.claims.aal='aal1'
 if(mode==='revoked')s.auth.getUser.mockResolvedValue({error:{}})
 if(mode==='mismatch')s.auth.getUser.mockResolvedValue({data:{user:{id:id(9)}}})
 if(mode==='signature')s.auth.getClaims.mockResolvedValue({error:{}})
 expect((await s.handler(s.request())).status).toBe(401);expect(s.service.rpc).not.toHaveBeenCalled()
})
it('requires bearer and blocks foreign origins',async()=>{
 const s=setup();expect((await s.handler(s.request(undefined,{authorization:''}))).status).toBe(401)
 expect((await s.handler(s.request(undefined,{origin:'https://other.test'}))).status).toBe(403);expect(s.service.rpc).not.toHaveBeenCalled()
})
it.each([null,[],{fixtureId:'invalid',email:'a@b.test'},{fixtureId:id(2),email:'bad'},{fixtureId:id(2),email:'x'.repeat(1100)}])('rejects malformed or oversized payload %#',async body=>{
 const s=setup();expect((await s.handler(s.request(body))).status).toBe(400);expect(s.service.rpc).not.toHaveBeenCalled()
})
it.each(['amountMinor','shopId','periodEnd','fixtureId'])('fails closed on unexpected %s from storage',async field=>{
 const s=setup();s.data[field]='unexpected';expect((await s.handler(s.request())).status).toBe(503)
})
it.each(['42501','55000'])('sanitizes storage error %s',async code=>{
 const s=setup();s.service.rpc.mockResolvedValue({error:{code,message:'private SQL contact'}})
 const r=await s.handler(s.request());expect(r.status).toBe(code==='42501'?403:503);expect(await r.text()).not.toContain('private')
})
it('disabled runtime does not create clients or read credentials',async()=>{
 const getEnv=vi.fn(()=>undefined),client=vi.fn(),s=setup()
 expect((await createFiscalAcceptanceRuntime(getEnv,client)(s.request())).status).toBe(503)
 expect(client).not.toHaveBeenCalled();expect(getEnv.mock.calls.flat()).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
})
it('runtime refuses another project even with enabled flags',async()=>{
 const env={YOOKASSA_SANDBOX_ENABLED:'true',ADMIN_FISCAL_ACCEPTANCE_PREPARE_ENABLED:'true',SUPABASE_URL:'https://other.supabase.co',SUPABASE_ANON_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic'}
 const client=vi.fn(),s=setup();expect((await createFiscalAcceptanceRuntime(n=>env[n],client)(s.request())).status).toBe(503);expect(client).not.toHaveBeenCalled()
})
