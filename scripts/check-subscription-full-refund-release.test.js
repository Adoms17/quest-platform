// @vitest-environment node
import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'
import { manifest, prerequisites, validateReceiptRelease, validateReceiptPreview, verifyReceiptFiles } from './check-subscription-full-refund-release.mjs'
const history=()=>({migrations:[...prerequisites.map(local=>({local,remote:local})),...manifest.map(m=>({local:m.version,remote:''}))]})
test('only the full refund migration is allowed and its bytes are pinned',()=>{
 expect(manifest.map(m=>m.version)).toEqual(['20260930010000'])
 verifyReceiptFiles()
 expect(validateReceiptRelease(history())).toEqual(['20260930010000'])
 const applied=history();applied.migrations.at(-1).remote='20260930010000'
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
 expect(validateReceiptPreview(manifest[0].file,['20260930010000'])).toEqual([manifest[0].file])
 expect(()=>validateReceiptPreview('', ['20260930010000'])).toThrow()
 expect(()=>validateReceiptPreview(manifest[0].file+'\n20990101000000_other.sql',['20260930010000'])).toThrow()
 expect(validateReceiptPreview('Database is up to date',[])).toEqual([])
})
test('stage apply disables dispatch and deploys compatible readers before migrating',()=>{
 const w=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 const job=w.slice(w.indexOf('  subscription-full-refund-body-migrate:'),w.indexOf('  subscription-acceptance-migrate:'))
 expect(job).toContain("github.ref == 'refs/heads/staging'")
 expect(job).toContain('ref: ${{ github.sha }}')
 expect(job).toContain('SUPABASE_PROJECT_ID: jeugfyaqzfgdvfhdxfht')
 expect(job).toContain('--require-applied')
 expect(job).not.toContain('=true')
 expect([...job.matchAll(/functions deploy ([a-z-]+)/g)].map(m=>m[1])).toEqual(['sandbox-reconcile','admin-subscription-fiscal-refund','sandbox-subscription-fiscal-order'])
 const disabled=job.indexOf('supabase secrets set'),deploy=job.indexOf('supabase functions deploy'),apply=job.indexOf('--include-all --yes')
 expect(disabled).toBeGreaterThan(0);expect(deploy).toBeGreaterThan(disabled);expect(apply).toBeGreaterThan(deploy)
 for(const flag of ['YOOKASSA_SANDBOX_SUBSCRIPTION_FISCAL_DISPATCH','YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_DISPATCH','ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED','YOOKASSA_SANDBOX_SETTLEMENT_DISPATCH'])expect(job).toContain(flag+'=false')
 expect(job.match(/if: inputs.operation == 'subscription-full-refund-body-apply'/g)).toHaveLength(4)
 expect(job.match(/--preview/g)).toHaveLength(2)
 expect(job).not.toContain('fiscal-dispatch')
})

test('new format fixture and offer workflows never start payment or enable dispatch',()=>{
 const w=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 for(const kind of ['fixture','offer']){
  const start=w.indexOf('  subscription-full-refund-body-'+kind+':')
  const end=w.indexOf('\n  subscription-',start+3)
  const job=w.slice(start,end)
  expect(start).toBeGreaterThan(0)
  expect(job).toContain("github.ref == 'refs/heads/staging'")
  expect(job).toContain('SUPABASE_PROJECT_ID: jeugfyaqzfgdvfhdxfht')
  expect(job).toContain('check-subscription-full-refund-release.mjs')
  expect(job).toContain('--require-applied')
  expect(job).toContain('rollback;')
  expect(job).toContain('scripts/stage-full-refund-body-'+(kind==='fixture'?'organization':'offer')+'.sql')
  expect(job).not.toContain('=true')
  expect(job).not.toContain('functions deploy')
 }
})