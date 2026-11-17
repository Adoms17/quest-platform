import { previewEndpoint, previewSlug, previewVersionId } from './snapshotPreviewPin'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const text = value => typeof value === 'string' && value.trim().length > 0
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text)
const range = min => value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isSafeInteger(n) && n >= min) && value[0] <= value[1]
const card = { title: text, description: text, audience: text, tags: strings, includes: strings }
const compatibility = {
  age: range(0), reading: text, knowledge: text, group: range(1), homeVenue: text, outdoorVenue: text,
  playMinutes: range(1), preparationMinutes: range(0), devices: text, connection: text, gps: text,
  printing: value => exact(value, ['mode', 'details']) && ['none', 'required'].includes(value.mode) && text(value.details),
  props: text, adult: text, weatherFallback: text, connectionFallback: text, adaptation: text,
}
const claim = (value, validate) => exact(value, ['status', 'value']) && (value.status === 'unknown'
  ? value.value === null : ['proposed', 'confirmed'].includes(value.status) && validate(value.value))
const section = (value, fields) => exact(value, Object.keys(fields)) && Object.entries(fields).every(([key, validate]) => claim(value[key], validate))
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)

export function validatePreviewSnapshot(snapshot) {
  const p = snapshot?.payload, m = snapshot?.manifest
  return exact(snapshot, ['payload', 'manifest', 'validation'])
    && m?.schemaVersion === 1 && m.projection === 'quest-public-offline-v1' && m.versionId === previewVersionId
    && m.source?.format === 'quest-passport-v1' && hash(m.source.contentId) && hash(m.payloadContentId)
    && m.publicationReady === false && m.commercialReady === false && object(m.trace)
    && snapshot.validation?.valid === true && snapshot.validation.publicationReady === false
    && exact(p, ['schemaVersion', 'mode', 'publicationStatus', 'commercialReady', 'card', 'compatibility', 'demo', 'parameterSchema', 'resources'])
    && p.schemaVersion === 1 && p.mode === 'demo' && p.publicationStatus === 'unpublished' && p.commercialReady === false
    && section(p.card, card) && section(p.compatibility, compatibility)
    && exact(p.demo, ['publicDemo', 'playable']) && p.demo.playable === false
    && claim(p.demo.publicDemo, value => exact(value, ['question', 'label', 'hint', 'inputMode'])
      && Object.values(value).every(text) && ['text', 'numeric'].includes(value.inputMode))
    && claim(p.parameterSchema, () => false) && claim(p.resources, () => false)
}

export function mapPreviewSnapshot(snapshot) {
  if (!validatePreviewSnapshot(snapshot)) throw new Error('Invalid local public DTO or unsupported manifest')
  const { payload, manifest } = structuredClone(snapshot)
  const c = payload.card, p = payload.compatibility
  return {
    slug: previewSlug, title: c.title.value ?? 'Название не указано', description: c.description.value,
    tags: c.tags.value, age: p.age.value, group: p.group.value, minutes: p.playMinutes.value,
    // No guessed venue enum; no invented preparation steps, artwork or answers.
    venues: [], print: p.printing.value?.mode ?? null,
    preview: { payload, manifest },
  }
}

export function createSnapshotPreviewAdapter({ load = async signal => {
  const response = await fetch(previewEndpoint, { signal, cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error('Local snapshot unavailable')
  return response.json()
} } = {}) {
  async function list({ signal } = {}) {
    const snapshot = await load(signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return [mapPreviewSnapshot(snapshot)]
  }
  return { preview: true, list, async find(slug, options) {
    const items = await list(options)
    return items.filter(item => item.slug === slug)
  } }
}
