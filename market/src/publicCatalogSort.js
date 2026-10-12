import { writeFilters } from './catalogFilters'

export function priceSortAvailable(items) {
  const offers = items.map(({ item }) => item.offer)
  return offers.length > 0 && offers.every(offer => offer && Number.isSafeInteger(offer.amount_minor) && offer.amount_minor > 0 && /^[A-Z]{3}$/.test(offer.currency)) && new Set(offers.map(offer => offer.currency)).size === 1
}
export function readSort(search, available) {
  const value = new URLSearchParams(search).get('sort')
  return available && ['price-asc', 'price-desc'].includes(value) ? value : 'default'
}
export function catalogSearch(filters, sort) {
  const params = new URLSearchParams(writeFilters(filters))
  if (sort !== 'default') params.set('sort', sort)
  return params.size ? `?${params}` : ''
}
export function sortCatalog(items, sort) {
  if (!priceSortAvailable(items) || !['price-asc', 'price-desc'].includes(sort)) return items
  // Compare integer minor units only within one currency; preserve ties and API default order.
  return [...items].sort((a, b) => (a.item.offer.amount_minor - b.item.offer.amount_minor) * (sort === 'price-asc' ? 1 : -1))
}
