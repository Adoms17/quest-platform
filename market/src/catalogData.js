import { fixtures, rangeLabel, venueLabels, withdrawnFixtures } from './fixtures'

export function createCatalogAdapter({ items = fixtures, withdrawn = withdrawnFixtures, delay = 100, fail = () => false } = {}) {
  async function load(signal, context) {
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delay)
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
      })
      if (fail(context)) throw new Error('Учебный источник временно недоступен')
  }
  return {
    async list({ signal } = {}) {
      await load(signal, { resource: 'catalog' })
      // Copy public fixture data: consumers cannot mutate subsequent adapter responses.
      return structuredClone(items.filter(item => !withdrawn.some(removed => removed.slug === item.slug)))
    },
    async find(slug, { signal, resource = 'details' } = {}) {
      await load(signal, { resource, slug })
      // A tombstone takes precedence: neither details nor demo revive a removed item.
      const item = withdrawn.find(item => item.slug === slug) || items.find(item => item.slug === slug)
      return item ? [structuredClone(item)] : []
    },
  }
}

export const emptyFilters = () => ({ q: '', age: [], group: [], venue: [], print: 'any' })
// URL input may contain encoded control characters; intentionally replace them.
// eslint-disable-next-line no-control-regex
const cleanQuery = value => [...String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, 200).join('').trim()
export function filterOptions(items) {
  const ranges = new Map(items.filter(item => Array.isArray(item.age)).map(item => [item.age.join('-'), item.age]))
  const groups = new Map(items.filter(item => Array.isArray(item.group)).map(item => [item.group.join('-'), item.group]))
  return {
    ages: [...ranges].sort((a, b) => a[1][0] - b[1][0]).map(([value, range]) => ({ value, range, label: `${rangeLabel(range)} лет` })),
    groups: [...groups].sort((a, b) => a[1][0] - b[1][0]).map(([value, range]) => ({ value, range, label: `${rangeLabel(range)} игроков` })),
    venues: Object.entries(venueLabels).filter(([value]) => items.some(item => item.venues?.includes(value))).map(([value, label]) => ({ value, label })),
    printing: new Set(items.map(item => item.print).filter(Boolean)).size > 1,
  }
}
export function readFilters(search, options) {
  const params = new URLSearchParams(search)
  const allowed = (key, choices) => [...new Set(params.getAll(key))].filter(value => choices.some(item => item.value === value)).sort()
  return { q: cleanQuery(params.get('q') || ''), age: allowed('age', options.ages), group: allowed('group', options.groups), venue: allowed('venue', options.venues), print: ['none', 'required'].includes(params.get('print')) && options.printing ? params.get('print') : 'any' }
}
export function writeFilters(filters) {
  const params = new URLSearchParams()
  if (cleanQuery(filters.q)) params.set('q', cleanQuery(filters.q))
  for (const key of ['age', 'group', 'venue']) for (const value of [...new Set(filters[key] || [])].sort()) params.append(key, value)
  if (filters.print !== 'any') params.set('print', filters.print)
  return params.size ? `?${params.toString()}` : ''
}
const normalize = value => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim()
export function selectQuests(items, filters) {
  const words = normalize(filters.q).split(/\s+/).filter(Boolean)
  return items.filter(item => {
    const publicText = normalize([item.title, item.description, ...(item.tags || [])].join(' '))
    const ageMatches = !filters.age.length || filters.age.some(value => {
      const [from, to] = value.split('-').map(Number)
      return Array.isArray(item.age) && item.age[0] <= to && item.age[1] >= from
    })
    const groupMatches = !filters.group?.length || filters.group.some(value => {
      const [from, to] = value.split('-').map(Number)
      return Array.isArray(item.group) && item.group[0] <= from && item.group[1] >= to
    })
    return words.every(word => publicText.includes(word)) && ageMatches && groupMatches
      && (!filters.venue.length || filters.venue.some(venue => item.venues?.includes(venue)))
      && (filters.print === 'any' || item.print === filters.print)
  })
}

export function checkDemo(demo, answer) {
  return normalize(answer) === normalize(demo.answer)
}
