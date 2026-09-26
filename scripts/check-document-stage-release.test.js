// @vitest-environment node
import { test,expect } from 'vitest'
import { manifest,validateDocumentRelease,verifyDocumentFiles } from './check-document-stage-release.mjs'
const history=()=>({migrations:[{local:'20260925030000',remote:'20260925030000'},...manifest.map(m=>({local:m.version,remote:''}))]})
test('exact local release files and pending set',()=>{
 expect(manifest).toHaveLength(9);verifyDocumentFiles()
 expect(validateDocumentRelease(history())).toEqual(manifest.map(m=>m.version).sort())
})
test('partially applied release is resumable',()=>{
 const h=history();h.migrations[1].remote=h.migrations[1].local
 expect(validateDocumentRelease(h)).toHaveLength(manifest.length-1)
})
test.each(['missing','unrelated','remote','duplicate'])('rejects %s history',kind=>{
 const h=history()
 if(kind==='missing')h.migrations.pop()
 if(kind==='unrelated')h.migrations.push({local:'20260927000000',remote:''})
 if(kind==='remote')h.migrations.push({local:'',remote:'20260927000000'})
 if(kind==='duplicate')h.migrations.push(h.migrations[0])
 expect(()=>validateDocumentRelease(h)).toThrow()
})

test('existing seven migrations leave only admin additions',()=>{
 const h=history();for(const row of h.migrations.slice(1,8))row.remote=row.local
 expect(validateDocumentRelease(h)).toEqual(['20260926017000','20260926018000'])
})
