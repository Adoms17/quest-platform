import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { emptyFilters, filterOptions, readFilters, selectQuests, writeFilters } from './catalogData'
import { useCatalog } from './useCatalog'
import { usePagePosition } from './usePagePosition'
import Filters from './Filters'
import { Cover, Help, HowItWorks, Icon, Meta, Status } from './ui'
import { PreviewCard } from './SnapshotPreview'

function Search({ value, onSearch, disabled }) {
  const [query, setQuery] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (previous !== value) { setPrevious(value); setQuery(value) }
  return <form className="search-form" role="search" onSubmit={event => { event.preventDefault(); if (!disabled) onSearch(query) }}><label className="search-field"><Icon name="search" /><span className="sr-only">Тема или название</span><input id="catalog-search" type="search" maxLength={200} disabled={disabled} value={query} onChange={event => setQuery(event.target.value)} placeholder="Тема или название" /></label><button id="catalog-search-submit" className="button" type="submit" disabled={disabled}>Найти</button></form>
}

export default function Catalog({ adapter }) {
  const catalog = useCatalog(adapter)
  const location = useLocation()
  const navigate = useNavigate()
  const options = useMemo(() => filterOptions(catalog.items), [catalog.items])
  const filters = useMemo(() => readFilters(location.search, options), [location.search, options])
  usePagePosition(catalog.status !== 'loading', 'Готовые квесты')
  const items = selectQuests(catalog.items, filters)
  const apply = value => { const search = writeFilters(value); if (search !== location.search) navigate({ pathname: '/', search }) }
  const supplied = new URLSearchParams(location.search)
  if (import.meta.env.DEV) supplied.delete('__qa')
  const adjusted = catalog.status === 'ready' && supplied.toString() !== writeFilters(filters).slice(1)
  const conditions = [
    ...(filters.q ? [{ key: 'q', value: filters.q, label: `Поиск: ${filters.q}` }] : []),
    ...filters.age.map(value => ({ key: 'age', value, label: options.ages.find(item => item.value === value)?.label })),
    ...filters.group.map(value => ({ key: 'group', value, label: options.groups.find(item => item.value === value)?.label })),
    ...filters.venue.map(value => ({ key: 'venue', value, label: options.venues.find(item => item.value === value)?.label })),
    ...(filters.print !== 'any' ? [{ key: 'print', value: filters.print, label: filters.print === 'none' ? 'Без печати' : 'С печатью' }] : []),
  ]
  function remove(condition) { apply({ ...filters, [condition.key]: condition.key === 'q' ? '' : condition.key === 'print' ? 'any' : filters[condition.key].filter(value => value !== condition.value) }); document.getElementById('catalog-search')?.focus({ preventScroll: true }) }
  function reset() { apply(emptyFilters()); document.getElementById('catalog-search')?.focus({ preventScroll: true }) }
  return <>
    <section className="catalog-intro"><p className="eyebrow">ИСТОРИИ ДЛЯ ВАШЕЙ КОМПАНИИ <span aria-hidden="true">✦</span></p><h1 id="page-title" tabIndex={-1}>Готовые квесты для<br className="wide-only" /> <em>новых приключений</em></h1><p className="lead">Контент — разово. Подготовьте под себя и проводите снова.</p><p className="muted">Учебная витрина: примеры вымышлены, продажи пока не подключены.</p></section>
    {adapter?.preview && <p role="note">Локальный preview · demo / unpublished. Фильтры используют предложенные значения без подтверждения; неизвестные значения не подменяются. Площадки не классифицированы.</p>}
    <section aria-label="Поиск и подбор квестов" className="catalog-tools">
      <Search value={filters.q} disabled={catalog.status !== 'ready'} onSearch={q => apply({ ...filters, q })} />
      {catalog.status === 'ready' && catalog.items.length > 0 && <Filters applied={filters} apply={apply} options={options} items={catalog.items} />}
    </section>
    {adjusted && <p className="muted" role="note">Параметры ссылки проверены: неизвестные значения не применены, повторы и формат нормализованы. Ниже показаны только действующие условия.</p>}
    <div className="results-bar"><div className="conditions" aria-label="Активные условия">{catalog.status === 'ready' && conditions.map(condition => <button id={`condition-${condition.key}-${condition.value}`} key={`${condition.key}-${condition.value}`} className="chip" onClick={() => remove(condition)} aria-label={`Снять условие: ${condition.label}`}>{condition.label}<span aria-hidden="true">×</span></button>)}{catalog.status === 'ready' && conditions.length > 0 && <button id="catalog-reset" className="text-button" onClick={reset}>Сбросить все условия</button>}</div>{catalog.status === 'ready' && <p role="status">Найдено квестов: <strong>{items.length}</strong><span className="editorial">Редакционный порядок</span></p>}</div>
    <Status preview={adapter?.preview} status={catalog.status} retry={catalog.retry} />
    {catalog.status === 'ready' && (catalog.items.length === 0 ? <section className="status-panel"><h2>Учебный каталог пока пуст</h2><p>Примеры ещё не добавлены. Это не список ваших покупок.</p></section> : items.length === 0 ? <section className="status-panel"><h2>По этим условиям квестов нет</h2><p>Ни один учебный пример не соответствует всем выбранным условиям. Другие квесты не подставлены. Снимите одно из условий выше или начните поиск заново.</p></section> : <div className="quest-grid">{items.map(quest => <article className="quest-card" key={quest.slug}>
      {quest.preview ? <PreviewCard quest={quest} location={location} /> : <><Cover quest={quest} /><div className="card-content"><p className="example-label">Учебный пример · не продаётся</p><h2>{quest.title}</h2><p className="card-description">{quest.description}</p><Meta quest={quest} /><p className="reading">{quest.reading}</p><p className="venue"><Icon name="home" />{quest.primaryVenue}</p><ul className="preparation">{quest.prepare.map(item => <li key={item}>{item}</li>)}</ul><div className="card-action"><span>Продажи не подключены</span><Link id={`quest-${quest.slug}`} className="button" to={`/quests/${quest.slug}`} state={{ catalogUrl: `/${location.search}`, catalogKey: location.key }} aria-label={`Подробнее: ${quest.title}`}>Подробнее<Icon name="chevron-right" /></Link></div></div>
    </>}</article>)}</div>)}
    <HowItWorks /><Help />
  </>
}
