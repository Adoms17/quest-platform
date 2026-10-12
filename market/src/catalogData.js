import { fixtures, venueLabels, withdrawnFixtures } from './fixtures'

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

export { emptyFilters, readFilters, writeFilters, selectQuests } from './catalogFilters'
import { filterOptions as sharedFilterOptions } from './catalogFilters'
export const filterOptions = items => sharedFilterOptions(items, venueLabels)

export function checkDemo(demo, answer) {
  return answer.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim() === demo.answer.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim()
}
