import { fireEvent, render, screen, within } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../src/App'
import { createCatalogAdapter } from '../src/catalogData'
import { fixtures, rangeLabel, venueLabels, withdrawnFixtures } from '../src/fixtures'

function mount(path, adapter = createCatalogAdapter({ delay: 0 })) {
  render(<MemoryRouter initialEntries={[path]}><App adapter={adapter} /><Link to="/quests/observatory-example/demo">Switch example</Link></MemoryRouter>)
}

describe('public product states', () => {
  it('keeps withdrawn items out of lists and overrides stale active detail/demo data', async () => {
    const removed = { ...withdrawnFixtures[0], slug: fixtures[0].slug }
    const adapter = createCatalogAdapter({ delay: 0, withdrawn: [removed] })
    expect((await adapter.list()).map(item => item.slug)).not.toContain(removed.slug)
    for (const resource of ['details', 'demo']) {
      const result = await adapter.find(removed.slug, { resource })
      expect(result).toEqual([removed])
      expect(result[0]).not.toHaveProperty('demo')
      result[0].title = 'changed'
    }
    expect(await adapter.find(removed.slug)).toEqual([removed])
    expect(await adapter.find('missing')).toEqual([])
  })

  it.each(['', '/demo'])('renders removed state rather than 404 or playable content: %s', async suffix => {
    mount(`/quests/withdrawn-example${suffix}`)
    expect(await screen.findByRole('heading', { name: 'Этот пример снят с витрины' })).toBeInTheDocument()
    expect(screen.queryByText('404')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Все квесты', exact: true })).toHaveAttribute('href', '/')
  })

  it.each(fixtures)('shows separate play/preparation and full compatibility for $slug', async quest => {
    mount(`/quests/${quest.slug}`)
    await screen.findByRole('heading', { name: quest.title, level: 1 })
    const expected = {
      Чтение: quest.reading, Знания: quest.knowledge, Группа: `${rangeLabel(quest.group)} игроков`,
      'Время игры': `${rangeLabel(quest.minutes)} минут`, Подготовка: quest.preparation, Взрослый: quest.adult,
      Устройства: quest.devices, 'Сеть и GPS': quest.network, Печать: quest.printText, Реквизит: quest.props,
      Площадки: quest.venues.map(value => venueLabels[value]).join(', '), Погода: quest.weather,
    }
    for (const [label, value] of Object.entries(expected)) {
      const term = screen.getByText(label, { selector: 'dt' })
      expect(within(term.parentElement).getByText(value, { selector: 'dd' })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Купить|Скопировать/ })).not.toBeInTheDocument()
  })

  it('separates demo load failure from wrong answer and retries the scoped source', async () => {
    const resources = []
    let failed = false
    const adapter = createCatalogAdapter({ delay: 0, fail: ({ resource }) => {
      resources.push(resource)
      if (resource !== 'demo' || failed) return false
      failed = true
      return true
    } })
    mount('/quests/attic-example/demo', adapter)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить демо')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    const input = await screen.findByRole('textbox', { name: 'Название предмета' })
    fireEvent.change(input, { target: { value: 'incorrect' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }))
    expect(screen.getByRole('status')).toHaveTextContent('Попробуйте ещё раз')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(resources).toEqual(['demo', 'demo'])
  })

  it('does not carry answer or success across a slug change within the demo route', async () => {
    mount('/quests/attic-example/demo')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Название предмета' }), { target: { value: fixtures[0].demo.answer } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }))
    expect(screen.getByRole('status')).toHaveTextContent('Верно!')
    fireEvent.click(screen.getByRole('link', { name: 'Switch example' }))
    expect(await screen.findByRole('textbox', { name: 'Количество звёзд' })).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Введите ответ')
    expect(screen.queryByText('Верно!')).not.toBeInTheDocument()
  })
})
