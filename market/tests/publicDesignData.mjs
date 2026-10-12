import { publicClaimFields } from '../src/publicCatalogContract.js'
export function publicRow(index = 1, overrides = {}) {
  const payload = Object.fromEntries(Object.entries(publicClaimFields).map(([section, fields]) => [section, Object.fromEntries(Object.keys(fields).map(key => [key, { status: 'unknown', value: null }]))]))
  const confirmed = value => ({ status: 'confirmed', value })
  payload.card.title = confirmed(`Проверочный квест ${index}`)
  payload.card.description = confirmed('Синтетические данные для локальной проверки интерфейса. Не предложение к продаже.')
  payload.card.tags = confirmed(['проверка'])
  payload.card.includes = confirmed(['Публичное описание', 'Публичный пример'])
  for (const [key, value] of Object.entries({ age: [8, 12], group: [2, 6], playMinutes: [40, 60], preparationMinutes: [10, 20], reading: 'Самостоятельное чтение', homeVenue: index === 1 ? 'Помещение А' : 'Помещение Б', printing: { mode: index === 1 ? 'required' : 'none', details: index === 1 ? 'Нужен принтер' : 'Без печати' }, devices: 'Устройство ведущего', adult: 'Нужен ведущий', ...overrides })) payload.compatibility[key] = value === null ? { status: 'unknown', value: null } : confirmed(value)
  payload.demo.publicDemo = confirmed({ label: 'Публичный пример', question: 'Найдите круг среди названий фигур: круг, квадрат.', hint: 'Фигура без углов.', inputMode: 'text' })
  return { slug: `public-${index}`, product_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, version_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, version_label: 'test-v1', state: 'published', payload, offer: { id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`, amount_minor: 12300, currency: 'RUB', sales_enabled: false } }
}
