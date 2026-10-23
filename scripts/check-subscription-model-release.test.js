// @vitest-environment node
import { test,expect } from 'vitest'
import { manifest,prerequisites,validateReceiptPreview,validateReceiptRelease,verifyReceiptFiles } from './check-subscription-model-release.mjs'
const history=()=>({migrations:[...prerequisites.map(version=>({local:version,remote:version})),...manifest.map(m=>({local:m.version,remote:''}))]})
test('exact local release files and pending set',()=>{
 expect(manifest).toHaveLength(3);verifyReceiptFiles()
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
