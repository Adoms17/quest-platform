import StandalonePublicExample from './StandalonePublicExample'
import { useMemo } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { BackLink } from './navigation'
import { useCatalog } from './useCatalog'
import { usePagePosition } from './usePagePosition'
import { purchasesDestination } from './appDestination'
import { marketSalesAllowed } from './salesPolicy'
import { claim, display, pinned, compatibilityLabels } from './publicCatalogView'
import { PublicMedia, PublicMeta, PublicPrice, PublicStatus } from './PublicMarketUi'

export default function PublicDetails({ adapter, demo = false }) {
  const { slug } = useParams()
  const location = useLocation()
  const [params] = useSearchParams()
  const version = params.get('version')
  const scoped = useMemo(() => ({ list: ({ signal }) => adapter.find(slug, { signal, version }) }), [adapter, slug, version])
  const state = useCatalog(scoped)
  const item = state.items[0]
  const title = item?.state === 'published' ? claim(item, 'card', 'title') : item?.state === 'withdrawn' ? 'Версия снята с публикации' : 'Квест не найден'
  usePagePosition(state.status !== 'loading', demo ? `${title} — демо` : title, 'магазин')
  const catalogUrl = location.state?.catalogUrl || '/'
  const catalogKey = location.state?.catalogKey
  const back = <BackLink to={catalogUrl} state={{ restoreKey: catalogKey }}>Все квесты</BackLink>
  if (state.status !== 'ready') return <>{back}<h1 id="page-title" tabIndex={-1}>{demo ? 'Публичное демо' : 'Описание квеста'}</h1><PublicStatus state={state} resource={demo ? 'демо' : 'описание'} /></>
  if (!item || item.state === 'withdrawn') return <>{back}<section className="status-panel"><h1 id="page-title" tabIndex={-1}>{title}</h1><p>{item ? 'Эта версия недоступна. Ранее купленные права сохранены.' : 'Проверьте адрес или выберите квест в каталоге.'}</p></section></>
  const app = purchasesDestination(import.meta.env.VITE_APP_ORIGIN)
  const checkout = app && new URL(`/organization/shop/offers/${item.offer.id}`, app).href
  const example = claim(item, 'demo', 'publicDemo')
  if (demo) return <div className="demo-page"><BackLink to={pinned(item)} state={{ catalogUrl, catalogKey, restoreKey: location.state?.detailsKey }}>К описанию квеста</BackLink><p className="public-demo-badge">Публичный пример</p><h1 id="page-title" tabIndex={-1}>Демо квеста</h1><p className="lead">{title}</p><p className="public-demo-notice" role="note">Настоящая попытка не создаётся. {example ? 'Ниже — опубликованный пример выбранной версии без проверки ответа и отдельный независимый пример с проверкой.' : 'Пример выбранной версии не опубликован. Можно попробовать отдельный независимый пример с проверкой.'}</p>{example ? <section className="demo-task product-demo"><p className="eyebrow">Пример выбранной версии · без проверки</p><h2>{example.label}</h2><p className="question">{example.question}</p>{example.hint && <details><summary>Подсказка</summary><p>{example.hint}</p></details>}</section> : <section className="status-panel"><h2>Демо пока не опубликовано</h2><p>Для этой версии нет публичного примера задания.</p></section>}<StandalonePublicExample key={item.version_id} /><Link className="button outline demo-link" to={pinned(item)} state={{ catalogUrl, catalogKey, restoreKey: location.state?.detailsKey }}>Вернуться к описанию</Link></div>
  return <>{back}<section className="public-product"><div><PublicMedia /></div><div className="product-summary"><p className="eyebrow">ГОТОВЫЙ КВЕСТ</p><h1 id="page-title" tabIndex={-1}>{title}</h1><p className="lead">{claim(item, 'card', 'description')}</p><p className="muted">Версия: {item.version_label}</p><PublicMeta item={item} />
    <section className="public-compatibility"><h2>Подойдёт вашей компании?</h2><p>Проверьте условия игры и подготовки до покупки. Неуказанные требования нужно уточнить.</p><dl className="public-compatibility-summary">{['homeVenue', 'adult', 'devices', 'printing'].map(key => <div key={key}><dt>{compatibilityLabels[key]}</dt><dd>{display(claim(item, 'compatibility', key))}</dd></div>)}</dl><details className="public-compatibility-all"><summary>Все условия и подготовка</summary><dl>{Object.entries(compatibilityLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{display(claim(item, 'compatibility', key))}</dd></div>)}</dl></details></section>
    <Link id="try-demo" className="button outline demo-link" to={`/quests/${slug}/demo?version=${item.version_id}`} state={{ catalogUrl, catalogKey, detailsKey: location.key }}>Посмотреть демо</Link>
    <div className="public-checkout"><PublicPrice offer={item.offer} /><div className="purchase-terms"><p>Разовая покупка редактируемой копии, независимо от подписки. Можно делать внутренние копии и проводить квест повторно, включая свои платные мероприятия, без доплаты за проведение.</p><p>На Free — один одновременно открытый квест и одно место команды.</p><p>Перепродажа и передача другой организации не разрешены.</p></div>{marketSalesAllowed(item.offer.sales_enabled) && checkout ? <a className="button demo-link" href={checkout}>Выбрать квест для организации</a> : <p className="commerce-note" role="status">Оформление сейчас недоступно.</p>}<p className="muted">Квест приобретает организация. Получатель и условия повторно проверяются в приложении. Новый платёж здесь не создаётся.</p></div>
  </div></section><section className="detail-sections"><h2>Что входит</h2>{claim(item, 'card', 'includes')?.length ? <ul>{claim(item, 'card', 'includes').map((entry, index) => <li key={index}>{entry}</li>)}</ul> : <p>Состав не указан.</p>}</section></>
}
