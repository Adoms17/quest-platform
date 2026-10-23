import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PublicMarket from '../src/PublicMarket'
import { minimalPublicRow, publicRow } from './publicDesignData.mjs'
import { validPublicItem } from '../src/publicCatalogContract'
import { catalogItem, catalogOptions } from '../src/publicCatalogView'
import { readFilters, selectQuests } from '../src/catalogFilters'

const unknown = () => minimalPublicRow()
function mount(rows, path = '/') {
  render(<MemoryRouter initialEntries={[path]}><PublicMarket adapter={{ list: vi.fn().mockResolvedValue(rows) }} /></MemoryRouter>)
}
it('explains disabled quick filters for one valid unknown-only publication', async () => {
  const row = unknown()
  expect(validPublicItem(row)).toBe(true)
  mount([row])
  await screen.findByRole('article')
  expect(screen.getByRole('button', { name: 'Возраст', exact: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Возраст', exact: true })).toHaveAccessibleDescription(/Возраст.*не указан/)
  expect(screen.getByRole('button', { name: 'Площадка', exact: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Площадка', exact: true })).toHaveAccessibleDescription(/Площадка.*не указана/)
  fireEvent.click(screen.getByRole('button', { name: 'Все фильтры' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('Возраст участников пока не указан.')).toBeVisible()
  expect(within(dialog).getByText('Площадка пока не указана.')).toBeVisible()
  expect(within(dialog).getByText('Размер группы пока не указан.')).toBeVisible()
  expect(within(dialog).getByText('Сведения о печати пока не указаны. Конкретный вариант исключит такие квесты.')).toBeVisible()
  expect(within(dialog).getAllByRole('radio')).toHaveLength(3)
  expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0)
})
it('retains explicit printing URL choices without interpreting unknown as no printing', () => {
  const items = [catalogItem(unknown())], options = catalogOptions(items)
  for (const print of ['none', 'required']) {
    const filters = readFilters(`?age=8-12&venue=missing&group=2-6&print=${print}`, options)
    expect(filters).toMatchObject({ age: [], venue: [], group: [], print })
    expect(selectQuests(items, filters)).toHaveLength(0)
  }
  expect(selectQuests(items, readFilters('', options))).toHaveLength(1)
})
it('clears a printing chip and preserves search with unknown-only metadata', async () => {
  mount([unknown()], '/?q=Проверочный&print=none')
  await screen.findByRole('heading', { name: 'По этим условиям квестов нет' })
  fireEvent.click(screen.getByRole('button', { name: 'Снять условие: Без печати' }))
  expect(await screen.findAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('searchbox')).toHaveValue('Проверочный')
})
it('shows the one confirmed group rather than hiding single-value metadata', async () => {
  mount([publicRow(1)])
  await screen.findByRole('article')
  expect(screen.getByRole('button', { name: 'Возраст', exact: true })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Все фильтры' }))
  expect(within(screen.getByRole('dialog')).getByLabelText('2–6 игроков')).toBeVisible()
})
it('keeps confirmed choices in mixed data and never matches unknown claims', () => {
  const items = [publicRow(1), unknown()].map(catalogItem), options = catalogOptions(items)
  expect(options.ages).toHaveLength(1)
  expect(options.venues).toHaveLength(1)
  expect(selectQuests(items, readFilters('?age=8-12&print=required', options))).toHaveLength(1)
  expect(selectQuests(items, readFilters('?print=none', options))).toHaveLength(0)
})
