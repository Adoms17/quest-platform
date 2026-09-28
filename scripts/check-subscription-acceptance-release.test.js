// @vitest-environment node
import { test,expect } from 'vitest'
import { manifest,prerequisites,validateReceiptPreview,validateReceiptRelease,verifyReceiptFiles } from './check-subscription-acceptance-release.mjs'
const history=()=>({migrations:[...prerequisites.map(version=>({local:version,remote:version})),...manifest.map(m=>({local:m.version,remote:''}))]})
test('exact local release files and pending set',()=>{
 expect(manifest).toHaveLength(2);verifyReceiptFiles()
 expect(validateReceiptRelease(history())).toEqual(manifest.map(m=>m.version).sort())
})
test('partially applied release is resumable',()=>{
 const h=history();h.migrations[prerequisites.length].remote=h.migrations[prerequisites.length].local
 expect(validateReceiptRelease(h)).toHaveLength(manifest.length-1)
})
test.each(['missing','unrelated','remote','duplicate'])('rejects %s history',kind=>{
 const h=history()
 if(kind==='missing')h.migrations.pop()
 if(kind==='unrelated')h.migrations.push({local:'20260927000000',remote:''})
 if(kind==='remote')h.migrations.push({local:'',remote:'20260927000000'})
 if(kind==='duplicate')h.migrations.push(h.migrations[0])
 expect(()=>validateReceiptRelease(h)).toThrow()
})

test('fully applied receipt release has no pending migrations',()=>{
 const h=history();for(const row of h.migrations)row.remote=row.local;
 expect(validateReceiptRelease(h)).toEqual([]);
})

test('missing applied prerequisite blocks receipts',()=>{
 const h=history();h.migrations.shift();expect(()=>validateReceiptRelease(h)).toThrow('Receipt prerequisites not applied');
})

test('dry-run must contain precisely the pending files',()=>{
 const pending=manifest.slice(0,2).map(item=>item.version)
 const output=manifest.slice(0,2).map(item=>' • '+item.file).join('\n')
 expect(validateReceiptPreview(output,pending)).toHaveLength(2)
 expect(()=>validateReceiptPreview('',pending)).toThrow()
 expect(()=>validateReceiptPreview(output+'\n20260926038000_tariff_monthly_prices.sql',pending)).toThrow()
 expect(()=>validateReceiptPreview(output,[pending[0]])).toThrow()
 expect(validateReceiptPreview('Database is up to date',[])).toEqual([])
})

test('refuses missing old receipt schema and out-of-order application',()=>{
 const h=history();h.migrations=h.migrations.filter(row=>row.local!=='20260926019000');
 expect(()=>validateReceiptRelease(h)).toThrow('Receipt prerequisites not applied');
 const broken=history();broken.migrations.at(-1).remote=broken.migrations.at(-1).local;
 expect(()=>validateReceiptRelease(broken)).toThrow('Non-prefix model release');
})

test('acceptance release deploys only isolated endpoints and keeps all send flags off',async()=>{
 const {readFileSync}=await import('node:fs')
 const workflow=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8')
 const section=workflow.slice(workflow.indexOf('  subscription-acceptance-migrate:'),workflow.indexOf('  receipt-probe-preflight:'))
 expect(section.match(/github.ref == 'refs\/heads\/staging'/g)).toHaveLength(2)
 expect(section.match(/--require-applied/g)).toHaveLength(2)
 expect([...section.matchAll(/functions deploy ([a-z-]+)/g)].map(m=>m[1])).toEqual(['sandbox-subscription-fiscal-order','admin-fiscal-acceptance-prepare'])
 const settings=section.split('\n').filter(line=>line.includes('supabase secrets set'))
 expect(settings).toHaveLength(2)
 for(const line of settings){
  for(const flag of ['ADMIN_FISCAL_ACCEPTANCE_PREPARE_ENABLED','YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED','YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_DISPATCH','ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED','YOOKASSA_SANDBOX_SUBSCRIPTION_FISCAL_DISPATCH'])expect(line).toContain(flag+'=false')
  expect(line).not.toContain('=true')
 }
})
