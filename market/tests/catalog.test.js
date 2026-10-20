import { describe, expect, it } from 'vitest'
import { fixtures } from '../src/fixtures'
import { checkDemo, createCatalogAdapter, emptyFilters, filterOptions, readFilters, selectQuests, writeFilters } from '../src/catalogData'

describe('public fixture adapter', () => {
  it('returns isolated copies in editorial order', async () => {
    const adapter = createCatalogAdapter({ delay: 0 })
    const result = await adapter.list()
    result[0].title = 'changed'
    expect((await adapter.list()).map(item => item.slug)).toEqual(fixtures.map(item => item.slug))
    expect((await adapter.list())[0].title).toBe(fixtures[0].title)
  })
  it('can distinguish a failed load from an empty catalog', async () => {
    await expect(createCatalogAdapter({ delay: 0, fail: () => true }).list()).rejects.toThrow()
    await expect(createCatalogAdapter({ delay: 0, items: [] }).list()).resolves.toEqual([])
  })
  it('cancels old requests without returning stale data', async () => {
    const controller = new AbortController()
    const promise = createCatalogAdapter().list({ signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
describe('catalog query contract', () => {
  const options = filterOptions(fixtures)
  it('roundtrips query, multiselect and printing with no duplicates', () => {
    const value = { q: 'космос', age: ['10-14'], group: [], venue: ['home', 'park'], print: 'none' }
    expect(readFilters(writeFilters(value), options)).toEqual(value)
  })
  it('drops unknown filters, bounds query and defaults printing to any', () => {
    const value = readFilters(`?venue=private&age=0-99&print=bogus&q=${'a'.repeat(250)}`, options)
    expect(value).toEqual({ ...emptyFilters(), q: 'a'.repeat(200) })
  })
  it('derives meaningful options from actual fixture ranges and venues', () => {
    expect(options.ages.map(item => item.value)).toEqual(['6-9', '9-12', '10-14'])
    expect(options.venues.map(item => item.value)).toEqual(['home', 'classroom', 'park'])
    expect(filterOptions([fixtures[2]]).printing).toBe(false)
  })
  it('searches public title, description and tags only, normalizing ё and case', () => {
    expect(selectQuests(fixtures, { ...emptyFilters(), q: '  ЗВЕЗДЫ  ' }).map(item => item.slug)).toEqual(['observatory-example'])
    expect(selectQuests(fixtures, { ...emptyFilters(), q: fixtures[0].demo.answer })).toEqual([])
    expect(selectQuests(fixtures, { ...emptyFilters(), q: 'Конверт' })).toEqual([])
  })
  it('uses AND between groups and OR within each group', () => {
    expect(selectQuests(fixtures, { ...emptyFilters(), venue: ['home', 'park'], print: 'none' }).map(item => item.slug)).toEqual(['observatory-example', 'park-example'])
    expect(selectQuests(fixtures, { ...emptyFilters(), venue: ['park'], print: 'required' })).toEqual([])
  })
  it('uses inclusive real age interval overlap, not invented age buckets', () => {
    expect(selectQuests(fixtures, { ...emptyFilters(), age: ['6-9'] }).map(item => item.slug)).toEqual(['attic-example', 'park-example'])
    expect(selectQuests(fixtures, { ...emptyFilters(), age: ['10-14'], venue: ['park'] })).toEqual([])
  })
  it('accepts normalized public demo answers', () => {
    expect(checkDemo(fixtures[0].demo, ' КНИГА ')).toBe(true)
    expect(checkDemo(fixtures[0].demo, 'карта')).toBe(false)
  })
  it('normalizes hostile and repeated URL values into a stable safe roundtrip', () => {
    const parsed = readFilters('?q=++Тайна%00+чердака++&q=ignored&age=9-12&age=bad&age=9-12&group=4-8&group=Infinity&venue=park&venue=home&print=required&secret=ignored', options)
    expect(parsed).toEqual({ q: 'Тайна чердака', age: ['9-12'], group: ['4-8'], venue: ['home', 'park'], print: 'required' })
    expect(writeFilters(readFilters(writeFilters(parsed), options))).toBe(writeFilters(parsed))
    expect(writeFilters(parsed)).not.toContain('ignored')
    expect(() => readFilters('?q=%E0%A4%A&group=-1-9', options)).not.toThrow()
    const boundary = readFilters(`?q=${'a'.repeat(199)}+b`, options)
    expect(readFilters(writeFilters(boundary), options)).toEqual(boundary)
  })
  it('requires full participant range coverage and OR within group, AND with venue', () => {
    expect(options.groups.map(item => item.value)).toEqual(['2-5', '3-6', '4-8'])
    expect(selectQuests(fixtures, { ...emptyFilters(), group: ['4-8'] }).map(item => item.slug)).toEqual(['attic-example'])
    expect(selectQuests(fixtures, { ...emptyFilters(), group: ['2-5', '4-8'] }).map(item => item.slug)).toEqual(['attic-example', 'park-example'])
    expect(selectQuests(fixtures, { ...emptyFilters(), group: ['4-8'], venue: ['park'] })).toEqual([])
  })
})
