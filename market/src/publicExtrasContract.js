// Candidate contract only. Not imported by the live catalog adapter or entrypoint.
// Shape validation is not publication authorization: the future publisher must
// verify review evidence, rights and content digests before exposing these records.
import { uuid } from './publicCatalogContract'

const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
const text = (v, max, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0)
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const integer = (v, max) => Number.isSafeInteger(v) && v > 0 && v <= max
const id = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(v)
const review = v => exact(v, ['status', 'review_id', 'rights_basis', 'attribution'])
  && v.status === 'approved' && uuid(v.review_id)
  && ['original', 'licensed', 'public-domain'].includes(v.rights_basis) && text(v.attribution, 500, v.rights_basis !== 'licensed')
const bound = (v, context) => context?.state === 'published' && uuid(context.product_id) && uuid(context.version_id)
  && v.product_id === context.product_id && v.version_id === context.version_id

export function validPublicCover(v, context) {
  return exact(v, ['schema_version', 'kind', 'product_id', 'version_id', 'asset_id', 'sha256', 'mime', 'path', 'width', 'height', 'alt', 'review'])
    && v.schema_version === 1 && v.kind === 'public-cover' && bound(v, context) && uuid(v.asset_id)
    && hash(v.sha256) && ['image/png', 'image/jpeg', 'image/webp'].includes(v.mime)
    && v.path === `/assets/public-covers/${v.sha256}.${{ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[v.mime]}`
    && integer(v.width, 8192) && integer(v.height, 8192) && text(v.alt, 300) && review(v.review)
}

export function validPublicDemo(v, context) {
  if (!exact(v, ['schema_version', 'kind', 'product_id', 'version_id', 'demo_id', 'revision', 'content_sha256', 'title', 'question', 'hint', 'choices', 'correct_choice_id', 'explanation', 'review'])
    || v.schema_version !== 1 || v.kind !== 'independent-single-choice' || !bound(v, context)
    || !uuid(v.demo_id) || !integer(v.revision, 1000000) || !hash(v.content_sha256) || !review(v.review)
    || !text(v.title, 150) || !text(v.question, 2000) || !text(v.hint, 1000, true) || !text(v.explanation, 2000)
    || !Array.isArray(v.choices) || v.choices.length < 2 || v.choices.length > 6) return false
  return v.choices.every(c => exact(c, ['id', 'label', 'feedback']) && id(c.id) && text(c.label, 200) && text(c.feedback, 1000))
    && new Set(v.choices.map(c => c.id)).size === v.choices.length && v.choices.some(c => c.id === v.correct_choice_id)
}

export function checkPublicDemo(record, context, choice) {
  if (!validPublicDemo(record, context)) return { status: 'unavailable' }
  if (choice === '') return { status: 'empty' }
  const option = record.choices.find(c => c.id === choice)
  if (!option) return { status: 'invalid' }
  return { status: choice === record.correct_choice_id ? 'correct' : 'retry', feedback: option.feedback,
    explanation: choice === record.correct_choice_id ? record.explanation : null }
}
