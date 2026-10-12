import { filterOptions } from './catalogFilters'

export const claim = (item, section, key) => {
  const field = item.payload?.[section]?.[key]
  return field?.status === 'confirmed' ? field.value : null
}
export const display = value => value == null || value === '' ? 'Не указано' : Array.isArray(value) ? value.join('–') : typeof value === 'object' ? value.details : value
export const pinned = item => `/quests/${item.slug}?version=${item.version_id}`

// View fields come only from the validated public claims. No inferred venue
// classification, editorial defaults, private content or fixture fallback.
export function catalogItem(item) {
  return {
    item, title: claim(item, 'card', 'title'), description: claim(item, 'card', 'description'),
    tags: claim(item, 'card', 'tags') || [], age: claim(item, 'compatibility', 'age'),
    group: claim(item, 'compatibility', 'group'),
    venues: [...new Set(['homeVenue', 'outdoorVenue'].map(key => claim(item, 'compatibility', key)).filter(Boolean))],
    print: claim(item, 'compatibility', 'printing')?.mode,
  }
}
export function catalogOptions(items) {
  const venues = Object.fromEntries(items.flatMap(item => item.venues).map(value => [value, value]))
  return { ...filterOptions(items, venues), printing: items.some(item => item.print) }
}
export const compatibilityLabels = {
  age: 'Возраст', reading: 'Чтение', knowledge: 'Знания', group: 'Размер группы',
  homeVenue: 'В помещении', outdoorVenue: 'На улице', playMinutes: 'Время игры, минуты',
  preparationMinutes: 'Подготовка, минуты', devices: 'Устройства', connection: 'Интернет',
  gps: 'GPS', printing: 'Печать', props: 'Реквизит', adult: 'Ведущий',
  weatherFallback: 'Плохая погода', connectionFallback: 'Без связи', adaptation: 'Адаптация',
}
