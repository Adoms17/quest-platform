import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createCatalogAdapter } from '../src/catalogData'
import { fixtures } from '../src/fixtures'

function Location() { const location = useLocation(); return <span data-testid="location">{location.pathname}{location.search}</span> }
function mount(path = '/', adapter = createCatalogAdapter({ delay: 0 })) {
  render(<MemoryRouter initialEntries={[path]}><App adapter={adapter} /><Location /></MemoryRouter>)
}
describe('market routes and states', () => {
  it('shows loading separately from a catalog and keeps prices/purchases absent', async () => {
    mount()
    expect(screen.getByText('Загружаем учебный каталог…')).toBeInTheDocument()
    expect(await screen.findAllByRole('article')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Купить|Копировать/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('₽')
  })
  it('retries a failed adapter without presenting no matches', async () => {
    const adapter = { list: vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue(fixtures) }
    mount('/?q=тайна', adapter)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить')
    expect(screen.queryByText('По этим условиям квестов нет')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(await screen.findAllByRole('article')).toHaveLength(1)
  })
  it('distinguishes no inventory from no matches', async () => {
    mount('/', createCatalogAdapter({ delay: 0, items: [] }))
    expect(await screen.findByText('Учебный каталог пока пуст')).toBeInTheDocument()
    expect(screen.queryByText('По этим условиям квестов нет')).not.toBeInTheDocument()
  })
  it('reads search from URL, removes a constraint and restores results', async () => {
    mount('/?q=небывалый')
    expect(await screen.findByText('По этим условиям квестов нет')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Снять условие: Поиск: небывалый' }))
    expect(await screen.findAllByRole('article')).toHaveLength(3)
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })
  it('keeps mobile filters as a draft until apply; cancel does not change URL', async () => {
    mount()
    await screen.findAllByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Возраст, площадка и печать' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByLabelText('В парке'))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    fireEvent.click(dialog.getByRole('button', { name: 'Закрыть фильтры' }))
    fireEvent.click(screen.getByRole('button', { name: 'Возраст, площадка и печать' }))
    expect(dialog.getByLabelText('В парке')).not.toBeChecked()
    fireEvent.click(dialog.getByLabelText('В парке'))
    fireEvent.click(dialog.getByRole('button', { name: 'Показать 1 квестов' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/?venue=park'))
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })
  it('loads details directly with concrete compatibility and honest commercial status', async () => {
    mount('/quests/attic-example')
    expect(await screen.findByRole('heading', { level: 1, name: 'Тайна старого чердака' })).toBeInTheDocument()
    expect(screen.getByText('Один телефон на команду; экран показывает ведущий')).toBeInTheDocument()
    expect(screen.getByText(/Цена не установлена/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Попробовать задание/ })).toHaveAttribute('href', '/quests/attic-example/demo')
  })
  it('resets an open desktop draft when a new URL search is applied', async () => {
    mount()
    await screen.findAllByRole('article')
    const desktop = within(document.querySelector('.desktop-filter'))
    fireEvent.click(desktop.getByLabelText('В парке'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'звёзды' } })
    fireEvent.click(screen.getByRole('button', { name: 'Найти', exact: true }))
    expect(desktop.getByLabelText('В парке')).not.toBeChecked()
    fireEvent.click(desktop.getByRole('button', { name: 'Показать 1 квестов' }))
    expect(screen.getByRole('searchbox')).toHaveValue('звёзды')
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })
  it('runs public demo feedback and restart without a write adapter', async () => {
    mount('/quests/attic-example/demo')
    const input = await screen.findByRole('textbox', { name: 'Название предмета' })
    fireEvent.change(input, { target: { value: 'карта' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }))
    expect(screen.getByRole('status')).toHaveTextContent('Попробуйте ещё раз')
    fireEvent.change(input, { target: { value: 'Книга' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }))
    expect(screen.getByRole('status')).toHaveTextContent('Верно!')
    fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })
  it('does not pretend to know purchase state or selected organization', async () => {
    mount('/purchases')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Квесты вашей организации')
    expect(screen.getByText(/Переход в приложение для этой витрины ещё не настроен/)).toBeInTheDocument()
  })
  it.each(['/not-a-route', '/quests/missing', '/quests/missing/demo'])('shows explicit 404 for %s', async path => {
    mount(path)
    expect(await screen.findByText('404')).toBeInTheDocument()
  })
})
