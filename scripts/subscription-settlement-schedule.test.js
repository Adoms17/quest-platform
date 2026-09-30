// @vitest-environment node
import {test,expect} from 'vitest'
import {scheduleSql} from './subscription-settlement-schedule.mjs'
const id='11111111-1111-4111-8111-111111111111'
test('preview rolls back and provision never activates',()=>{
 expect(scheduleSql('preview',id)).toMatch(/rollback;\s*$/)
 expect(scheduleSql('provision',id)).toMatch(/commit;\s*$/)
 expect(scheduleSql('provision',id)).not.toContain('set enabled=true')
})
test('enable rechecks admission before atomic activation',()=>{
 const sql=scheduleSql('enable',id)
 expect(sql.indexOf('schedule admission denied')).toBeLessThan(sql.indexOf('set enabled=true'))
 expect(sql).toContain('and not active')
 expect(sql).toMatch(/commit;\s*$/)
})
test('rejects invalid target and mode',()=>{
 for(const value of ['',"';commit;--",undefined])expect(()=>scheduleSql('enable',value)).toThrow()
 expect(()=>scheduleSql('other',id)).toThrow()
 expect(scheduleSql('disable')).toContain('enabled=false')
})

test('workflow validates target before activation and closes both gates on failure',async()=>{
 const {readFileSync}=await import('node:fs')
 const w=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 const job=w.slice(w.indexOf('  subscription-settlement-schedule:'),w.indexOf('  subscription-settlement-fixture:'))
 expect(job).toContain("github.ref == 'refs/heads/staging'")
 expect(job).toContain('ref: ${{ github.sha }}')
 expect(job).toContain('--require-applied')
 expect(job.indexOf('--file "$RUNNER_TEMP/settlement-preview.sql"')).toBeLessThan(job.indexOf('YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED=true'))
 expect(job).toContain('YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ID=$SANDBOX_ORDER_ID')
 expect(job).toContain("(failure() || cancelled())")
 expect(job).toContain('--file scripts/disable-stage-subscription-settlement.sql')
})
