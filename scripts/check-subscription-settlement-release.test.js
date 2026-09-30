// @vitest-environment node
import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'
import { manifest, prerequisites, validateReceiptRelease, validateReceiptPreview, verifyReceiptFiles } from './check-subscription-settlement-release.mjs'
const history=()=>({migrations:[...prerequisites.map(local=>({local,remote:local})),...manifest.map(m=>({local:m.version,remote:''}))]})
test('only the settlement schedule migration is allowed and its bytes are pinned',()=>{
 expect(manifest.map(m=>m.version)).toEqual(['20260930020000'])
 verifyReceiptFiles()
 expect(validateReceiptRelease(history())).toEqual(['20260930020000'])
 const applied=history();applied.migrations.at(-1).remote='20260930020000'
 expect(validateReceiptRelease(applied)).toEqual([])
})
test.each(['missing','unrelated','remote','duplicate','prerequisite'])('blocks %s migration history',kind=>{
 const h=history()
 if(kind==='missing')h.migrations.pop()
 if(kind==='unrelated')h.migrations.push({local:'20990101000000',remote:''})
 if(kind==='remote')h.migrations.push({local:'',remote:'20990101000000'})
 if(kind==='duplicate')h.migrations.push(h.migrations[0])
 if(kind==='prerequisite')h.migrations.shift()
 expect(()=>validateReceiptRelease(h)).toThrow()
})
test('preview contains precisely one approved migration',()=>{
 expect(validateReceiptPreview(manifest[0].file,['20260930020000'])).toEqual([manifest[0].file])
 expect(()=>validateReceiptPreview('', ['20260930020000'])).toThrow()
 expect(()=>validateReceiptPreview(manifest[0].file+'\n20990101000000_other.sql',['20260930020000'])).toThrow()
 expect(validateReceiptPreview('Database is up to date',[])).toEqual([])
})
test('disabled settlement apply migrates before deploying one endpoint',()=>{
 const w=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 const job=w.slice(w.indexOf('  subscription-settlement-migrate:'),w.indexOf('  subscription-full-refund-body-migrate:'))
 expect(job).toContain("github.ref == 'refs/heads/staging'")
 expect(job).toContain('ref: ${{ github.sha }}')
 expect(job).toContain('YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED=false')
 expect(job).not.toContain('=true')
 expect(job).toContain('--require-applied')
 expect(job.indexOf('supabase secrets set')).toBeLessThan(job.indexOf('--include-all --yes'))
 expect(job.indexOf('--require-applied')).toBeLessThan(job.indexOf('functions deploy'))
 expect([...job.matchAll(/functions deploy ([a-z-]+)/g)].map(m=>m[1])).toEqual(['sandbox-subscription-settlement-order'])
})
test('fixture preparation does not enable dispatch or prepare payment',()=>{
 const w=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 const job=w.slice(w.indexOf('  subscription-settlement-fixture:'))
 expect(job).toContain('check-subscription-settlement-release.mjs')
 expect(job).toContain('--require-applied')
 expect(job).toContain('YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED=false')
 expect(job).toContain('rollback;')
 expect(job).not.toContain('=true')
 const sql=readFileSync(new URL('./stage-subscription-settlement-fixture.sql',import.meta.url),'utf8')
 expect(sql).toContain('stage-settlement-fixture-20260930')
 expect(sql).not.toContain('reserve_sandbox_payment_order')
 expect(sql).not.toContain('cron.alter_job')
})
