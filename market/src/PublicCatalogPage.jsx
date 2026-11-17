import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Filters from './Filters'
import Icon from './Icon'
import { emptyFilters, readFilters, selectQuests } from './catalogFilters'
import { catalogItem, catalogOptions, claim, display, pinned } from './publicCatalogView'
import { PublicMedia, PublicMeta, PublicPrice, PublicStatus } from './PublicMarketUi'
import { priceSortAvailable, readSort, catalogSearch, sortCatalog } from './publicCatalogSort'
import { useCatalog } from './useCatalog'
import { usePagePosition } from './usePagePosition'

function Search({ value, apply, disabled }) {
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (previous !== value) { setPrevious(value); setDraft(value) }
  return <form className="search-form" role="search" onSubmit={event => { event.preventDefault(); apply(draft) }}>
    <label className="search-field"><Icon name="search" /><span className="sr-only">Тема или название</span><input id="catalog-search" type="search" maxLength={200} placeholder="Тема или название" value={draft} onChange={event => setDraft(event.target.value)} disabled={disabled} /></label><button className="button" disabled={disabled}>Найти</button>
  </form>
}
export default function PublicCatalog({ adapter }) {
  const state = useCatalog(adapter)
  const location = useLocation()
  const navigate = useNavigate()
  const candidates = useMemo(() => state.items.filter(item => item.state === 'published').map(catalogItem), [state.items])
  const options = useMemo(() => catalogOptions(candidates), [candidates])
  const filters = useMemo(() => readFilters(location.search, options), [location.search, options])
  const canSortPrice = priceSortAvailable(candidates)
  const sort = readSort(location.search, canSortPrice)
  const items = sortCatalog(selectQuests(candidates, filters), sort)
  usePagePosition(state.status !== 'loading', 'Готовые квесты', 'магазин')
  const apply = (next, nextSort = sort) => { const search = catalogSearch(next, nextSort); if (search !== location.search) navigate({ pathname: '/', search }) }
  const conditions = [
    ...(filters.q ? [{ key: 'q', value: filters.q, label: `Поиск: ${filters.q}` }] : []),
    ...['age', 'group', 'venue'].flatMap(key => filters[key].map(value => ({ key, value, label: options[{ age: 'ages', group: 'groups', venue: 'venues' }[key]].find(option => option.value === value)?.label }))),
    ...(filters.print === 'any' ? [] : [{ key: 'print', value: filters.print, label: filters.print === 'none' ? 'Без печати' : 'С печатью' }]),
  ]
  const reset = () => { apply(emptyFilters()); document.getElementById('catalog-search')?.focus({ preventScroll: true }) }
  const suggestedRemoval = conditions.find(condition => condition.key === 'print') || conditions.at(-1)
  const remove = condition => { apply({ ...filters, [condition.key]: condition.key === 'q' ? '' : condition.key === 'print' ? 'any' : filters[condition.key].filter(value => value !== condition.value) }); document.getElementById('catalog-search')?.focus({ preventScroll: true }) }
  return <>
    <section className="catalog-intro"><p className="eyebrow">КАТАЛОГ ПО СИТУАЦИИ</p><h1 id="page-title" tabIndex={-1}>Готовые квесты</h1><p className="lead">Выберите историю для вашей компании.</p></section>
    <section className="catalog-tools" aria-label="Поиск и подбор квестов"><Search value={filters.q} apply={q => apply({ ...filters, q })} disabled={state.status !== 'ready'} />{state.status === 'ready' && candidates.length > 0 && <Filters publicPresentation applied={filters} apply={apply} items={candidates} options={options} />}{state.status === 'ready' && candidates.length > 0 && <label className="catalog-sort">Порядок квестов<select id="catalog-sort" value={sort} onChange={event => apply(filters, event.target.value)} aria-describedby={!canSortPrice ? 'price-sort-note' : undefined}><option value="default">По умолчанию</option><option value="price-asc" disabled={!canSortPrice}>Сначала дешевле</option><option value="price-desc" disabled={!canSortPrice}>Сначала дороже</option></select></label>}</section>{state.status === 'ready' && candidates.length > 0 && !canSortPrice && <p id="price-sort-note" className="muted">Сортировка по цене доступна только для каталога с одной валютой и указанными ценами.</p>}
    {state.status === 'ready' && <><div className="results-bar"><div className="conditions" aria-label="Активные условия">{conditions.map(condition => <button className="chip" key={`${condition.key}-${condition.value}`} aria-label={`Снять условие: ${condition.label}`} onClick={() => remove(condition)}>{condition.label}<Icon name="x" /></button>)}{conditions.length > 0 && <button className="text-button" onClick={reset}>Сбросить все условия</button>}</div><p role="status">Найдено: <strong>{items.length}</strong></p></div>{location.search !== catalogSearch(filters, sort) && <p className="muted" role="note">Неизвестные параметры ссылки не применены. Показаны только действующие условия.</p>}</>}
    <PublicStatus state={state} />
    {state.status === 'ready' && (candidates.length === 0 ? <section className="status-panel"><h2>Каталог пока пуст</h2><p>Опубликованных квестов пока нет. Ваши покупки доступны отдельно в приложении.</p></section> : items.length === 0 ? <section className="status-panel public-no-matches"><img className="empty-illustration" src="/assets/empty-lighthouse.svg" alt="" aria-hidden="true" /><h2>По этим условиям квестов нет</h2><p>Попробуйте убрать одно условие, чтобы увидеть больше квестов.</p>{suggestedRemoval && <button className="button" onClick={() => remove(suggestedRemoval)}>Убрать условие «{suggestedRemoval.label}»</button>}<button className="text-button" onClick={reset}>Сбросить фильтры</button></section> : <div className="quest-grid public-grid">{items.map(({ item, venues }) => <article className="quest-card" key={item.version_id}>
      <PublicMedia /><div className="card-content"><h2><Link id={`quest-${item.slug}`} to={pinned(item)} state={{ catalogUrl: `/${location.search}`, catalogKey: location.key }}>{claim(item, 'card', 'title')}</Link></h2><p className="card-description">{claim(item, 'card', 'description')}</p><PublicMeta item={item} />
        <p className="reading">Чтение: {display(claim(item, 'compatibility', 'reading'))}</p><p className="venue"><Icon name="home" /><span>{venues.length ? venues.join(' · ') : 'Площадка не указана'}</span></p><p className="preparation">Подготовка: {display(claim(item, 'compatibility', 'preparationMinutes'))}{claim(item, 'compatibility', 'preparationMinutes') ? ' мин' : ''}</p>
        <div className="card-action"><PublicPrice offer={item.offer} /><Link id={`quest-details-${item.version_id}`} className="button" to={pinned(item)} state={{ catalogUrl: `/${location.search}`, catalogKey: location.key }} aria-label={`Подробнее: ${claim(item, 'card', 'title')}`}>Подробнее<Icon name="chevron-right" /></Link></div>
      </div></article>)}</div>)}
  </>
}
