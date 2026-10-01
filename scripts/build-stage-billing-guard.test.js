// @vitest-environment node
import { expect,test } from 'vitest'
import { buildStageBillingGuard } from './build-stage-billing-guard.js'
test.each([undefined,'szjiwamevblkpjmmeonf','stage',''])('rejects non-stage target %s',projectRef=>{
 expect(()=>buildStageBillingGuard({projectRef})).toThrow('Stage project required')
})
test('assembles reviewed guards and sandbox initialization under one outer transaction',()=>{
 const sql=buildStageBillingGuard({projectRef:'jeugfyaqzfgdvfhdxfht'})
 expect(sql.match(/^begin;$/gm)).toHaveLength(1)
 expect(sql.match(/^commit;$/gm)).toHaveLength(1)
 const guard=sql.indexOf('create table platform_private.billing_runtime_environment')
 const pin=sql.indexOf('create function platform_private.protect_billing_environment_identity')
 const init=sql.indexOf("insert into platform_private.billing_runtime_environment(environment) values('sandbox')")
 expect(guard).toBeGreaterThan(0);expect(pin).toBeGreaterThan(guard);expect(init).toBeGreaterThan(pin)
 expect(sql).toContain('sandbox guard source hash mismatch')
 expect(sql).toContain('refund recovery entry marker missing or ambiguous')
 expect(sql).toContain('fiscal worker entry marker missing or ambiguous')
 expect(sql.trim().endsWith('commit;')).toBe(true)
})
