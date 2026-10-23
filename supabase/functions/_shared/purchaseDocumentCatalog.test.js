// @vitest-environment node
import { test, expect } from 'vitest'
import { documentDigest, selectPurchaseDocuments as select, assertReviewedDocuments as accept } from './purchaseDocumentCatalog.js'
async function row(kind, id = kind.replace('_','-'), effectiveAtMs = 100) {
 const text = 'Synthetic terms ' + id
 return { id, kind, status: 'published', text, sha256: await documentDigest(text), publishedAtMs: 50, effectiveAtMs }
}
async function base() { return [await row('agreement'), await row('payment_terms')] }
test('requires both published document types', async () => {
 await expect(select([], 100)).rejects.toThrow()
 await expect(select([await row('agreement')], 100)).rejects.toThrow()
 const rows = await base(); rows[1].status = 'draft'
 await expect(select(rows, 100)).rejects.toThrow()
})
test('switches exactly at effective date and returns stable revision paths', async () => {
 const rows = [...await base(), await row('agreement', 'next', 200)]
 expect((await select(rows,199))[0].id).toBe('agreement')
 expect((await select(rows,200))[0].path).toBe('/documents/agreement/next')
})
test('rejects changed text, including whitespace', async () => {
 const rows = await base(); rows[0].text += ' '
 await expect(select(rows,100)).rejects.toThrow()
})
test('rejects ambiguous publication dates and duplicate identities', async () => {
 const rows = await base()
 await expect(select([...rows, await row('agreement','duplicate')],100)).rejects.toThrow()
 await expect(select([...rows, rows[0]],100)).rejects.toThrow()
})
test('rejects invalid trusted timestamps and publication metadata', async () => {
 await expect(select(await base(),NaN)).rejects.toThrow()
 const rows = await base(); rows[0].publishedAtMs=101
 await expect(select(rows,100)).rejects.toThrow()
})
test('requires explicit acceptance and rejects stale or repeated references', async () => {
 const required=await select(await base(),100)
 expect(() => accept(required,required,false)).toThrow('purchase_documents_not_accepted')
 expect(() => accept(required,[required[0],required[0]],true)).toThrow('purchase_documents_changed')
 expect(() => accept(required,[required[0],{kind:'payment_terms',id:'old'}],true)).toThrow('purchase_documents_changed')
 expect(() => accept(required,[...required].reverse(),true)).not.toThrow()
})
