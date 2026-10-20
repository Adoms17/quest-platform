// @vitest-environment node
import { test,expect } from 'vitest'
import { manifest,validateRefundRelease,verifyRefundFiles } from './check-refund-stage-release.mjs'
const history=()=>({migrations:[{local:'20260925030000',remote:'20260925030000'},...manifest.map(m=>({local:m.version,remote:''}))]})
test('exact local release files and pending set',()=>{
 expect(manifest).toHaveLength(21);verifyRefundFiles()
 expect(validateRefundRelease(history())).toEqual(manifest.map(m=>m.version).sort())
})
test('partially applied release is resumable',()=>{
 const h=history();h.migrations[1].remote=h.migrations[1].local
 expect(validateRefundRelease(h)).toHaveLength(20)
})
test.each(['missing','unrelated','remote','duplicate'])('rejects %s history',kind=>{
 const h=history()
 if(kind==='missing')h.migrations.pop()
 if(kind==='unrelated')h.migrations.push({local:'20260927000000',remote:''})
 if(kind==='remote')h.migrations.push({local:'',remote:'20260927000000'})
 if(kind==='duplicate')h.migrations.push(h.migrations[0])
 expect(()=>validateRefundRelease(h)).toThrow()
})
