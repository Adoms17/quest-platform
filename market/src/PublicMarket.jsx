import { marketSalesAllowed } from './salesPolicy'
import { useMemo } from 'react'
import { Link, Route, Routes, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useCatalog } from './useCatalog'
import { purchasesDestination } from './appDestination'
import { formatShopAmount } from '../../src/services/shopMoney'

const value = (item, section, key) => item.payload?.[section]?.[key]?.value
const render = entry => entry == null ? 'Не указано' : Array.isArray(entry) ? entry.join(' — ') : typeof entry === 'object' ? entry.details : entry
const pinned = item => `/quests/${item.slug}?version=${item.version_id}`
function Status({ state }) {
  return <section className="status-panel" role={state.status === 'error' ? 'alert' : 'status'}>{state.status === 'loading' ? 'Загрузка каталога…' : <>Не удалось загрузить каталог. <button onClick={state.retry}>Повторить загрузку</button></>}</section>
}
function Catalog({ adapter }) {
  const state = useCatalog(adapter)
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') || '').slice(0, 200)
  const age = params.get('age') || ''
  const printing = params.get('print') || ''
  const group = params.get('group') || ''
  const venue = params.get('venue') || ''
  const set = (key, text) => { const next = new URLSearchParams(params); if (text) next.set(key, text); else next.delete(key); setParams(next, { replace: true }) }
  const items = state.items.filter(item => {
    const text = [value(item, 'card', 'title'), value(item, 'card', 'description'), ...(value(item, 'card', 'tags') || [])].join(' ').toLocaleLowerCase('ru').replaceAll('ё', 'е')
    const range = value(item, 'compatibility', 'age')
    const players = value(item, 'compatibility', 'group')
    const venues = [value(item, 'compatibility', 'homeVenue'), value(item, 'compatibility', 'outdoorVenue')].filter(Boolean)
    return q.toLocaleLowerCase('ru').replaceAll('ё', 'е').split(/\s+/).every(word => text.includes(word))
      && (!age || (range && Number(age) >= range[0] && Number(age) <= range[1]))
      && (!group || (players && Number(group) >= players[0] && Number(group) <= players[1]))
      && (!venue || venues.includes(venue))
      && (!printing || value(item, 'compatibility', 'printing')?.mode === printing)
  })
  return <><h1>Каталог квестов</h1><p>Квест приобретает организация. Рабочие копии доступны в приложении.</p>
    <form onSubmit={event => event.preventDefault()}><label>Поиск <input type="search" value={q} onChange={event => set('q', event.target.value)} /></label> <label>Возраст <input type="number" min="0" max="120" value={age} onChange={event => set('age', event.target.value)} /></label> <label>Игроков <input type="number" min="1" value={group} onChange={event => set('group', event.target.value)} /></label> <label>Площадка <select value={venue} onChange={event => set('venue', event.target.value)}><option value="">Любая</option>{[...new Set(state.items.flatMap(item => [value(item, 'compatibility', 'homeVenue'), value(item, 'compatibility', 'outdoorVenue')]).filter(Boolean))].map(entry => <option key={entry} value={entry}>{entry}</option>)}</select></label> <label>Печать <select value={printing} onChange={event => set('print', event.target.value)}><option value="">Любая</option><option value="none">Не нужна</option><option value="required">Нужна</option></select></label> <button type="button" onClick={() => setParams({})}>Сбросить фильтры</button></form>
    {state.status !== 'ready' ? <Status state={state} /> : <><p role="status">Найдено: {items.length}</p><div className="catalog-grid">{items.map(item => <article className="quest-card" key={item.version_id}><div className="card-content"><h2><Link to={pinned(item)} state={{ catalogUrl: `/${location.search}` }}>{value(item, 'card', 'title')}</Link></h2><p>{value(item, 'card', 'description')}</p><p>Возраст: {render(value(item, 'compatibility', 'age'))}</p><p>{formatShopAmount(item.offer.amount_minor, item.offer.currency)} {item.offer.currency}</p><Link className="button" to={pinned(item)} state={{ catalogUrl: `/${location.search}` }}>Подробнее</Link></div></article>)}</div>{!items.length && <p>Подходящих квестов нет. Измените фильтры.</p>}</>}
  </>
}
function Details({ adapter, demo = false }) {
  const { slug } = useParams()
  const location = useLocation()
  const catalogUrl = location.state?.catalogUrl || '/'
  const [params] = useSearchParams()
  const version = params.get('version')
  const scoped = useMemo(() => ({ list: ({ signal }) => adapter.find(slug, { signal, version }) }), [adapter, slug, version])
  const state = useCatalog(scoped)
  const item = state.items[0]
  if (state.status !== 'ready') return <Status state={state} />
  if (!item) return <section><h1>Квест не найден</h1><Link to="/">Каталог</Link></section>
  if (item.state === 'withdrawn') return <section><h1>Версия снята с публикации</h1><p>Новые заказы недоступны. Ранее купленные копии сохранены.</p><Link to="/">Каталог</Link></section>
  const app = purchasesDestination(import.meta.env.VITE_APP_ORIGIN)
  const checkout = app && new URL(`/organization/shop/offers/${item.offer.id}`, app).href
  const example = value(item, 'demo', 'publicDemo')
  return <><Link to={catalogUrl}>Каталог</Link><h1>{value(item, 'card', 'title')}{demo ? ' — демо' : ''}</h1><p>Версия: {item.version_label}</p>
    {demo ? <section><p>Публичный пример. Проверка ответа здесь не выполняется.</p>{example ? <><h2>{example.label}</h2><p>{example.question}</p><details><summary>Подсказка</summary>{example.hint}</details></> : <p>Демо для этой версии не опубликовано.</p>}<Link to={pinned(item)} state={{ catalogUrl }}>Описание</Link></section>
      : <><p className="lead">{value(item, 'card', 'description')}</p><h2>Условия проведения</h2><dl>{Object.entries(item.payload.compatibility).map(([key, claim]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{render(claim.value)}</dd></div>)}</dl><h2>В комплекте</h2><ul>{(value(item, 'card', 'includes') || []).map((entry, index) => <li key={index}>{entry}</li>)}</ul><Link className="button" to={`/quests/${slug}/demo?version=${item.version_id}`} state={{ catalogUrl }}>Посмотреть демо</Link><p>{formatShopAmount(item.offer.amount_minor, item.offer.currency)} {item.offer.currency}</p>{marketSalesAllowed(item.offer.sales_enabled) && checkout ? <a className="button" href={checkout}>Оформить заказ для организации</a> : <p>Оформление сейчас недоступно.</p>}<p>Актуальность предложения, организация и условия повторно проверяются в приложении. Оплата пока отключена.</p></>}
  </>
}
const labels = { age: 'Возраст', reading: 'Чтение', knowledge: 'Знания', group: 'Размер группы', homeVenue: 'В помещении', outdoorVenue: 'На улице', playMinutes: 'Время игры, минуты', preparationMinutes: 'Подготовка, минуты', devices: 'Устройства', connection: 'Интернет', gps: 'GPS', printing: 'Печать', props: 'Реквизит', adult: 'Взрослый', weatherFallback: 'Плохая погода', connectionFallback: 'Нет связи', adaptation: 'Адаптация' }
export default function PublicMarket({ adapter }) {
  const app = purchasesDestination(import.meta.env.VITE_APP_ORIGIN)
  return <><header className="site-header wrap"><Link to="/" className="brand">Квеста</Link><nav><Link to="/">Каталог</Link> {app && <a href={app}>Мои покупки</a>}</nav></header><main className="wrap"><Routes><Route path="/" element={<Catalog adapter={adapter} />} /><Route path="/quests/:slug" element={<Details adapter={adapter} />} /><Route path="/quests/:slug/demo" element={<Details adapter={adapter} demo />} /><Route path="*" element={<><h1>Страница не найдена</h1><Link to="/">Каталог</Link></>} /></Routes></main></>
}
