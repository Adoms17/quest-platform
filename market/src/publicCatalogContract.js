const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
const text = v => typeof v === 'string'
const range = v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 999999) && v[0] <= v[1]
const strings = v => Array.isArray(v) && v.every(text)
const printing = v => exact(v, ['mode', 'details']) && ['none', 'required'].includes(v.mode) && text(v.details)
const demo = v => exact(v, ['question', 'label', 'hint', 'inputMode']) && Object.values(v).every(text) && ['text', 'numeric'].includes(v.inputMode)
export const publicClaimFields = {
  card: { title: text, description: text, audience: text, tags: strings, includes: strings },
  compatibility: { age: range, reading: text, knowledge: text, group: range, homeVenue: text, outdoorVenue: text, playMinutes: range, preparationMinutes: range, devices: text, connection: text, gps: text, printing, props: text, adult: text, weatherFallback: text, connectionFallback: text, adaptation: text },
  demo: { publicDemo: demo },
}
export const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
export function validPublicItem(row) {
  if (!exact(row, ['slug', 'product_id', 'version_id', 'version_label', 'state', 'payload', 'offer']) || !uuid(row.product_id) || !uuid(row.version_id) || !text(row.version_label) || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(row.slug)) return false
  if (row.state === 'withdrawn') return row.payload === null && row.offer === null
  if (row.state !== 'published' || !exact(row.payload, Object.keys(publicClaimFields))) return false
  for (const [section, fields] of Object.entries(publicClaimFields)) {
    if (!exact(row.payload[section], Object.keys(fields))) return false
    for (const [key, validate] of Object.entries(fields)) {
      const claim = row.payload[section][key]
      if (!exact(claim, ['status', 'value']) || !(claim.status === 'unknown' ? claim.value === null : claim.status === 'confirmed' && validate(claim.value))) return false
    }
  }
  return row.payload.card.title.status === 'confirmed' && row.payload.card.title.value.trim().length > 0 && row.payload.card.description.status === 'confirmed'
    && exact(row.offer, ['id', 'amount_minor', 'currency', 'sales_enabled']) && uuid(row.offer.id) && Number.isSafeInteger(row.offer.amount_minor) && row.offer.amount_minor > 0 && /^[A-Z]{3}$/.test(row.offer.currency) && typeof row.offer.sales_enabled === 'boolean'
}
