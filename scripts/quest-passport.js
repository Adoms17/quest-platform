// Local editorial format only. Never import the authoring pack into a browser bundle.
const text = value => typeof value === 'string' && value.trim().length > 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length
const range = (value, minimum) => Array.isArray(value) && value.length === 2 && value.every(n => Number.isSafeInteger(n) && n >= minimum) && value[0] <= value[1]
const rows = (value, keys) => Array.isArray(value) && value.length > 0 && value.every(row => exact(row, keys) && keys.every(key => text(row[key]))) && new Set(value.map(row => row.id)).size === value.length

export const passportFields = {
  title: text, description: text, audience: text, age: value => range(value, 0), reading: text, knowledge: text,
  group: value => range(value, 1), tags: strings,
  homeVenue: text, outdoorVenue: text,
  playMinutes: value => range(value, 1), preparationMinutes: value => range(value, 0), preparationSteps: strings,
  devices: text, connection: text, gps: text,
  printing: value => exact(value, ['mode', 'details']) && ['none', 'required'].includes(value.mode) && text(value.details),
  props: text, adult: text, weatherFallback: text, connectionFallback: text,
  taskPlan: value => rows(value, ['id', 'goal', 'mechanic']), adaptation: text, includes: strings,
  publicDemo: value => exact(value, ['question', 'answer', 'label', 'explanation', 'hint', 'inputMode']) && ['text', 'numeric'].includes(value.inputMode) && Object.values(value).every(text),
  facilitatorPack: text, runChecklist: strings,
  rights: value => exact(value, ['basis', 'scope']) && ['original', 'licensed'].includes(value.basis) && text(value.scope),
  pilot: value => exact(value, ['summary', 'venues', 'playMinutes', 'preparationMinutes']) && text(value.summary) && strings(value.venues) && value.venues.every(v => ['home', 'outdoor'].includes(v)) && range(value.playMinutes, 1) && range(value.preparationMinutes, 0),
  freeRun: value => exact(value, ['openQuests', 'teamSeats', 'outcome', 'notes']) && Number.isSafeInteger(value.openQuests) && value.openQuests >= 0 && Number.isSafeInteger(value.teamSeats) && value.teamSeats >= 0 && ['passed', 'failed', 'not-run'].includes(value.outcome) && text(value.notes),
}
const privateFields = {
  tasks: value => rows(value, ['id', 'prompt', 'answer', 'facilitatorNotes']),
  materials: value => rows(value, ['id', 'content']),
}
const requiredKind = { rights: 'rights', pilot: 'pilot', homeVenue: 'venue', outdoorVenue: 'venue', freeRun: 'free-run', publicDemo: 'public-demo' }
const evidenceKinds = ['source', 'rights', 'pilot', 'venue', 'free-run', 'public-demo']
const reference = value => {
  if (!text(value)) return false
  if (value.startsWith('https://')) {
    try { const url = new URL(value); return Boolean(url.hostname) && !url.username && !url.password } catch { return false }
  }
  return /^(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_.-]+(?:#[a-zA-Z0-9_-]+)?$/.test(value)
}
const unknown = () => ({ status: 'unknown', value: null, evidence: [] })
export const createEmptyPassport = () => ({ schemaVersion: 1, claims: Object.fromEntries(Object.keys(passportFields).map(key => [key, unknown()])), evidence: [] })
export const createEmptyPrivatePack = () => ({ schemaVersion: 1, claims: Object.fromEntries(Object.keys(privateFields).map(key => [key, unknown()])) })

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validatePassport(passport, privatePack) {
  const issues = []
  const add = (severity, path, code, message) => issues.push({ severity, path, code, message })
  const stats = { unknown: 0, proposed: 0, confirmedDeclared: 0 }
  const evidence = new Map()
  if (!exact(passport, ['schemaVersion', 'claims', 'evidence']) || passport.schemaVersion !== 1) add('error', 'passport', 'shape', 'Ожидается локальный паспорт schemaVersion 1 с claims и evidence.')
  if (!exact(privatePack, ['schemaVersion', 'claims']) || privatePack.schemaVersion !== 1) add('error', 'privatePack', 'shape', 'Ожидается отдельный локальный пакет schemaVersion 1 с claims.')
  if (!Array.isArray(passport?.evidence)) add('error', 'evidence', 'shape', 'Нужен массив источников, в том числе пустой для незаполненного паспорта.')
  else passport.evidence.forEach((source, index) => {
    const path = `evidence[${index}]`
    const keys = ['id', 'kind', 'reference', 'supports', 'reviewStatus', 'reviewedBy', 'reviewedOn']
    if (!exact(source, keys) || !text(source.id) || !evidenceKinds.includes(source.kind) || !reference(source.reference) || !strings(source.supports) || !['unreviewed', 'reviewed'].includes(source.reviewStatus)) {
      add('error', path, 'source-shape', 'Источник требует id, kind, reference, supports и явные поля человеческого рассмотрения.'); return
    }
    if (evidence.has(source.id)) add('error', path, 'duplicate-source', 'Идентификатор источника повторяется.')
    else evidence.set(source.id, source)
    if (source.supports.some(key => !Object.hasOwn(passportFields, key) && !Object.hasOwn(privateFields, key))) add('error', path, 'source-scope', 'supports должен ссылаться на известные поля паспорта или закрытого пакета.')
    if (source.reviewStatus === 'reviewed' && (!text(source.reviewedBy) || !dateOnly(source.reviewedOn))) add('error', path, 'review-metadata', 'Рассмотренный источник требует reviewedBy и календарную дату YYYY-MM-DD.')
    if (source.reviewStatus === 'unreviewed' && (source.reviewedBy !== null || source.reviewedOn !== null)) add('error', path, 'review-metadata', 'Нерассмотренный источник должен иметь null в reviewedBy/reviewedOn.')
  })

  function checkClaims(claims, definitions, prefix) {
    if (!exact(claims, Object.keys(definitions))) add('error', prefix, 'fields', 'Нужны все известные поля и только они; неизвестные поля не игнорируются.')
    for (const [key, validateValue] of Object.entries(definitions)) {
      const claim = claims?.[key]
      const path = `${prefix}.${key}`
      if (!exact(claim, ['status', 'value', 'evidence']) || !['unknown', 'proposed', 'confirmed'].includes(claim.status) || !Array.isArray(claim.evidence) || !claim.evidence.every(text) || new Set(claim.evidence).size !== claim.evidence.length) {
        add('error', path, 'claim-shape', 'Нужны status unknown/proposed/confirmed, value и уникальный массив evidence.'); continue
      }
      stats[claim.status === 'confirmed' ? 'confirmedDeclared' : claim.status]++
      if (claim.status === 'unknown') {
        if (claim.value !== null || claim.evidence.length) add('error', path, 'unknown-value', 'Незаполненное поле имеет value null и evidence [].')
        add('gap', path, 'missing', 'Не заполнено.'); continue
      }
      if (!validateValue(claim.value)) add('error', path, 'value', 'Неверная структура значения или диапазон; проверьте формат поля в README.')
      if (claim.status === 'proposed') add('gap', path, 'proposed', 'Предложено, но не подтверждено человеком.')
      for (const id of claim.evidence) if (!evidence.has(id)) add('error', path, 'missing-source', 'Ссылка evidence не найдена в реестре источников.')
      if (claim.status === 'confirmed') {
        const supports = claim.evidence.map(id => evidence.get(id)).filter(source => source?.supports.includes(key) && source.reviewStatus === 'reviewed' && text(source.reviewedBy) && dateOnly(source.reviewedOn))
        if (!supports.length || (requiredKind[key] && !supports.some(source => source.kind === requiredKind[key]))) add('gap', path, 'unsupported-confirmation', 'Заявлено подтверждение без рассмотренного источника нужного вида и области.')
      }
    }
  }
  checkClaims(passport?.claims, passportFields, 'claims')
  checkClaims(privatePack?.claims, privateFields, 'privatePack.claims')
  const claims = passport?.claims
  const pilot = claims?.pilot
  if (pilot?.status === 'confirmed' && passportFields.pilot(pilot.value) && !['home', 'outdoor'].every(venue => pilot.value.venues.includes(venue))) add('gap', 'claims.pilot', 'venue-pilot', 'Для эталона нужны отдельные подтверждения домашнего и внешнего проведения; пилот не охватывает обе площадки.')
  const free = claims?.freeRun
  if (free?.status === 'confirmed' && passportFields.freeRun(free.value) && (free.value.openQuests !== 1 || free.value.teamSeats !== 1 || free.value.outcome !== 'passed')) add('gap', 'claims.freeRun', 'free-not-demonstrated', 'Не зафиксировано успешное проведение с одним открытым квестом и одним местом команды.')
  const tasks = claims?.taskPlan?.value
  const privateTasks = privatePack?.claims?.tasks?.value
  if (passportFields.taskPlan(tasks) && privateFields.tasks(privateTasks)) {
    const publicIds = tasks.map(task => task.id).sort()
    const privateIds = privateTasks.map(task => task.id).sort()
    if (JSON.stringify(publicIds) !== JSON.stringify(privateIds)) add('gap', 'privatePack.claims.tasks', 'task-mapping', 'План заданий и закрытые задания должны иметь одинаковые идентификаторы.')
  }
  return { structureValid: !issues.some(issue => issue.severity === 'error'), complete: issues.length === 0, publicationReady: false, stats, issues }
}

export function formatPassportReport(result) {
  return [
    `Структура: ${result.structureValid ? 'VALID' : 'INVALID'}`,
    `Полнота локальной записи: ${result.complete ? 'COMPLETE' : 'INCOMPLETE'}`,
    'Готовность к публикации: НЕ ОПРЕДЕЛЯЕТСЯ этим инструментом.',
    'Подтверждения только заявлены редактором. Источники, права и реальный пилот требуют человеческой проверки; ссылки не открывались.',
    `Незаполнено: ${result.stats.unknown}; предложено: ${result.stats.proposed}; заявлено подтверждённым: ${result.stats.confirmedDeclared}.`,
    ...result.issues.map(issue => `[${issue.severity === 'error' ? 'ERROR' : 'GAP'}] ${issue.path} (${issue.code}): ${issue.message}`),
  ].join('\n')
}
