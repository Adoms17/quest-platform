// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {fiscalTargetCheck,runStageFiscalOrder} from './run-stage-fiscal-order.mjs'
const token='ab'.repeat(32),orderId='11111111-1111-4111-8111-111111111111'
it.each(['',undefined,"x'; drop table public.organizations;--"])('rejects malformed target before SQL generation',id=>expect(()=>fiscalTargetCheck(id)).toThrow('invalid_order_id'))
it('calls only isolated endpoint once and strips extra output',async()=>{
 const fetcher=vi.fn(async()=>Response.json({checked:1,failed:0,unresolved:0,dispatched:0,private:'hidden'}))
 expect(await runStageFiscalOrder(token,{orderId},fetcher)).toEqual({checked:1,failed:0,unresolved:0,dispatched:0})
 expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-subscription-fiscal-order',expect.objectContaining({redirect:'error',method:'POST'}))
})
it('invalid token prevents network request',async()=>{
 const fetcher=vi.fn();await expect(runStageFiscalOrder('',{orderId},fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled()
})
it.each([{checked:0,failed:1,unresolved:0,dispatched:0},{checked:0,failed:0,unresolved:1,dispatched:0},{checked:0,failed:0,unresolved:0,dispatched:1},{checked:-1,failed:0,unresolved:0,dispatched:0},{}])('does not report success for unsafe results %j',async data=>{
 await expect(runStageFiscalOrder(token,{orderId},async()=>Response.json(data))).rejects.toThrow()
})
it('dispatch accepts at most one settlement',async()=>{
 const data={checked:1,failed:0,unresolved:0,dispatched:1}
 expect(await runStageFiscalOrder(token,{dispatch:true,orderId},async()=>Response.json(data))).toEqual(data)
 await expect(runStageFiscalOrder(token,{dispatch:true,orderId},async()=>Response.json({...data,dispatched:2}))).rejects.toThrow()
})
it('never retries uncertain HTTP',async()=>{
 const fetcher=vi.fn(async()=>new Response(null,{status:503}))
 await expect(runStageFiscalOrder(token,{orderId},fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce()
})
it('workflow checks target before enabling and always closes only isolated flags',()=>{
 const w=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 const job=w.slice(w.indexOf('  subscription-acceptance-fiscal-run:'),w.indexOf('  receipt-probe-preflight:'))
 expect(job).toContain("github.ref == 'refs/heads/staging'")
 expect(job.indexOf('--file "$RUNNER_TEMP/fiscal-target.sql"')).toBeLessThan(job.indexOf('YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED=true'))
 expect(job).toContain('if: always()')
 expect(job).toContain('YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED=false YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_DISPATCH=false')
 expect(job).not.toContain('YOOKASSA_SANDBOX_ENABLED=')
 expect(job).not.toContain('run-stage-billing-worker')
})
