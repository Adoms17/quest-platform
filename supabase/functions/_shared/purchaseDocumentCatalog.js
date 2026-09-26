// Consumes trusted server registry rows; never use client-supplied rows or time.
const kinds = ['agreement', 'payment_terms']
const fail = () => { throw new Error('purchase_documents_unavailable') }
export async function documentDigest(text) {
 if (typeof text !== 'string' || !text.trim()) fail()
 const bytes = new TextEncoder().encode(text)
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export async function selectPurchaseDocuments(rows, nowMs) {
 if (!Array.isArray(rows) || !Number.isSafeInteger(nowMs)) fail()
 const ids = new Set(), starts = new Set(), published = []
 for (const row of rows) {
  if (!row || !kinds.includes(row.kind) || !['draft', 'published'].includes(row.status)) fail()
  if (typeof row.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(row.id) || ids.has(row.id)) fail()
  ids.add(row.id)
  if (row.status === 'draft') continue
  if (!Number.isSafeInteger(row.effectiveAtMs) || !Number.isSafeInteger(row.publishedAtMs)
   || row.publishedAtMs > row.effectiveAtMs || row.publishedAtMs > nowMs) fail()
  const start = row.kind + ':' + row.effectiveAtMs
  if (starts.has(start)) fail()
  starts.add(start)
  if (await documentDigest(row.text) !== row.sha256) fail()
  if (row.effectiveAtMs <= nowMs) published.push(row)
 }
 return kinds.map(kind => {
  const row = published.filter(r => r.kind === kind).sort((a,b) => b.effectiveAtMs - a.effectiveAtMs)[0]
  if (!row) fail()
  return { id: row.id, kind, sha256: row.sha256, effectiveAtMs: row.effectiveAtMs,
   path: '/documents/' + row.kind + '/' + row.id }
 })
}
export function assertReviewedDocuments(required, reviewed, accepted) {
 if (accepted !== true || !Array.isArray(required) || required.length !== kinds.length
  || !kinds.every(kind => required.filter(r => r.kind === kind).length === 1)
  || !Array.isArray(reviewed) || reviewed.length !== required.length) throw new Error('purchase_documents_not_accepted')
 if (!required.every(r => reviewed.filter(v => v && v.id === r.id && v.kind === r.kind).length === 1)) {
  throw new Error('purchase_documents_changed')
 }
}
