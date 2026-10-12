import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PublicMarket from '../src/PublicMarket'
import { publicRow } from './publicDesignData.mjs'
import { catalogItem, catalogOptions, claim } from '../src/publicCatalogView'
import { readFilters, writeFilters, selectQuests } from '../src/catalogFilters'

afterEach(() => { vi.unstubAllEnvs() })
const rows = [publicRow(1), publicRow(2), publicRow(3, { age: null, group: null, homeVenue: null, printing: null })]
function mount(items = rows, path = '/') {
  const adapter = { list: vi.fn().mockResolvedValue(items), find: vi.fn().mockResolvedValue(items.slice(0, 1)) }
  render(<MemoryRouter initialEntries={[path]}><PublicMarket adapter={adapter} /></MemoryRouter>)
  return adapter
}
it('derives filter choices from confirmed raw claims, using OR within groups and AND between them', () => {
  const items = rows.map(catalogItem), options = catalogOptions(items)
  expect(options.venues.map(item => item.label)).toEqual(['Помещение А', 'Помещение Б'])
  const filters = readFilters('?venue=Помещение+А&venue=Помещение+Б&print=none&secret=ignored', options)
  expect(selectQuests(items, filters).map(item => item.item.slug)).toEqual(['public-2'])
  expect(writeFilters(filters)).not.toContain('secret')
  expect(readFilters('', options).print).toBe('any')
  expect(claim({ payload: { compatibility: { age: { status: 'unknown', value: [1, 99] } } } }, 'compatibility', 'age')).toBeNull()
})
it('renders authoritative card claims and distinguishes unknown values without fixture text or price', async () => {
  mount()
  const cards = await screen.findAllByRole('article')
  expect(cards).toHaveLength(3)
  expect(cards[0]).toHaveTextContent('Подготовка: 10–20 мин')
  expect(cards[2]).toHaveTextContent('Возраст: не указано')
  expect(screen.getAllByText('Обложка не опубликована')).toHaveLength(3)
  expect(screen.queryByText(/Тайна старого чердака|1490|1 490/)).toBeNull()
})
it('keeps empty publication state distinct from zero filter matches and allows reset', async () => {
  mount(rows, '/?q=absent')
  await screen.findByRole('heading', { name: 'По этим условиям квестов нет' })
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить все условия' }))
  expect(await screen.findAllByRole('article')).toHaveLength(3)
})
it('shows no published catalog without claiming that the buyer has no purchases', async () => {
  mount([])
  await screen.findByRole('heading', { name: 'Каталог пока пуст' })
  expect(screen.getByText(/Ваши покупки доступны отдельно/)).toBeVisible()
})
it('relaxes only printing from zero matches, preserving the search and venue', async () => {
  mount(rows, '/?q=Проверочный&venue=Помещение+А&print=none')
  await screen.findByRole('heading', { name: 'По этим условиям квестов нет' })
  fireEvent.click(screen.getByRole('button', { name: 'Убрать условие «Без печати»' }))
  expect(await screen.findAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('searchbox')).toHaveValue('Проверочный')
  expect(screen.getByRole('button', { name: 'Снять условие: Помещение А' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Снять условие: Без печати' })).toBeNull()
})
it('keeps the version pinned through public demo and returns to the same filtered catalog', async () => {
  const adapter = mount(rows, '/?q=Проверочный')
  fireEvent.click((await screen.findAllByRole('link', { name: /Подробнее:/ }))[0])
  await screen.findByRole('heading', { name: 'Подойдёт вашей компании?' })
  expect(adapter.find).toHaveBeenLastCalledWith('public-1', expect.objectContaining({ version: rows[0].version_id }))
  const demo = screen.getByRole('link', { name: 'Посмотреть демо' })
  expect(demo).toHaveAttribute('href', `/quests/public-1/demo?version=${rows[0].version_id}`)
  fireEvent.click(demo)
  await screen.findByRole('heading', { name: 'Публичный пример' })
  expect(screen.getByText(/Настоящая попытка не создаётся/)).toBeVisible()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(within(document.querySelector('.product-demo')).queryByRole('button', { name: /Проверить/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Проверить', exact: true })).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: /К описанию квеста/ }))
  await screen.findByRole('heading', { name: 'Подойдёт вашей компании?' })
  expect(screen.getByRole('link', { name: /Все квесты/ }).getAttribute('href')).toContain('q=')
})
it('shows compatibility before purchase and preserves app-only purchase handoff and sales OFF', async () => {
  vi.stubEnv('MODE', 'staging')
  vi.stubEnv('VITE_MARKET_SALES_ENABLED', 'true')
  vi.stubEnv('VITE_APP_ORIGIN', 'https://stage.qvesta.ru')
  mount([{ ...rows[0], offer: { ...rows[0].offer, sales_enabled: true } }], '/quests/public-1')
  await screen.findByRole('heading', { name: 'Подойдёт вашей компании?' })
  fireEvent.click(screen.getByText('Все условия и подготовка'))
  expect(within(document.querySelector('.public-compatibility')).getByText('GPS')).toBeVisible()
  expect(document.querySelector('a[href*="/shop/offers/"]')).toBeNull()
  expect(screen.getByRole('link', { name: 'Мои покупки' })).toHaveAttribute('href', 'https://stage.qvesta.ru/organization/purchases')
})
it('keeps an unpublished version demo distinct from the independent example', async () => {
  const row = publicRow()
  row.payload.demo.publicDemo = { status: 'unknown', value: null }
  mount([row], `/quests/public-1/demo?version=${row.version_id}`)
  await screen.findByRole('heading', { name: 'Демо пока не опубликовано' })
  expect(screen.getByText(/Это не задание выбранного квеста/)).toBeVisible()
  expect(document.querySelector('.product-demo')).toBeNull()
  expect(screen.getByRole('button', { name: 'Проверить', exact: true })).toBeVisible()
})
