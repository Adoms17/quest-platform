import { expect, it } from 'vitest'
import { emptyFilters } from '../src/catalogFilters'
import { priceSortAvailable, readSort, catalogSearch, sortCatalog } from '../src/publicCatalogSort'
const row = (amount, currency = 'RUB') => ({ item: { offer: { amount_minor: amount, currency } } })
it('sorts exact integer minor units, keeps ties and never mutates default order', () => {
  const items = [row(10001), row(9999), row(10001)]
  expect(sortCatalog(items, 'price-asc')).toEqual([items[1], items[0], items[2]])
  expect(sortCatalog(items, 'price-desc')).toEqual([items[0], items[2], items[1]])
  expect(sortCatalog(items, 'default')).toBe(items)
  expect(items[0].item.offer.amount_minor).toBe(10001)
})
it.each([[row(1), row(2, 'USD')], [row(null)], [row(0)], [row(1.5)], [row(Number.MAX_SAFE_INTEGER + 1)], [{ item: { offer: null } }], []].map(items => ({ items })))('disallows incomplete, invalid or mixed-currency prices %#', ({ items }) => {
  expect(priceSortAvailable(items)).toBe(false)
  expect(sortCatalog(items, 'price-asc')).toBe(items)
})
it('supports currency-specific minor units without conversion', () => {
  expect(sortCatalog([row(20, 'JPY'), row(1, 'JPY')], 'price-asc').map(x => x.item.offer.amount_minor)).toEqual([1, 20])
})
it('keeps old filter URLs and safely normalizes sorting', () => {
  const filters = { ...emptyFilters(), q: 'тема', venue: ['Дома'] }
  expect(readSort('?sort=popular', true)).toBe('default')
  expect(readSort('', true)).toBe('default')
  expect(readSort('?sort=price-asc', false)).toBe('default')
  const url = catalogSearch(filters, 'price-desc')
  expect(new URLSearchParams(url).get('q')).toBe('тема')
  expect(new URLSearchParams(url).get('venue')).toBe('Дома')
  expect(readSort(url, true)).toBe('price-desc')
  expect(catalogSearch(emptyFilters(), 'default')).toBe('')
})
