import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuest } from './useQuest'
import { BackLink } from './navigation'
import { usePagePosition } from './usePagePosition'
import { Cover, Help, Meta, NotFound, Status, WithdrawnExample } from './ui'
import { rangeLabel, venueLabels } from './fixtures'
import { PreviewDetails } from './SnapshotPreview'

export default function Details({ adapter }) {
  const { slug } = useParams()
  const location = useLocation()
  const catalog = useQuest(adapter, slug, 'details')
  const quest = catalog.items.find(item => item.slug === slug)
  usePagePosition(catalog.status !== 'loading', quest?.title || 'Квест не найден')
  if (catalog.status !== 'ready') return <><BackLink to={location.state?.catalogUrl || '/'} state={{ restoreKey: location.state?.catalogKey }}>Все квесты</BackLink><h1 id="page-title" tabIndex={-1}>Описание учебного квеста</h1><Status preview={adapter?.preview} status={catalog.status} retry={catalog.retry} resource="details" /></>
  if (!quest) return <NotFound product />
  if (quest.status === 'withdrawn') return <WithdrawnExample quest={quest} backTo={location.state?.catalogUrl || '/'} catalogKey={location.state?.catalogKey} />
  if (quest.preview) return <PreviewDetails quest={quest} location={location} />
  const compatibility = [
    ['Чтение', quest.reading], ['Знания', quest.knowledge], ['Группа', `${rangeLabel(quest.group)} игроков`],
    ['Время игры', `${rangeLabel(quest.minutes)} минут`], ['Подготовка', quest.preparation], ['Взрослый', quest.adult],
    ['Устройства', quest.devices], ['Сеть и GPS', quest.network], ['Печать', quest.printText], ['Реквизит', quest.props],
    ['Площадки', quest.venues.map(value => venueLabels[value]).join(', ')], ['Погода', quest.weather],
  ]
  return <>
    <BackLink to={location.state?.catalogUrl || '/'} state={{ restoreKey: location.state?.catalogKey }}>Все квесты</BackLink>
    <section className="product-hero"><div className="product-picture"><Cover quest={quest} /><p className="example-label">Обложка учебного примера. Не реальный товар.</p></div><div className="product-summary"><p className="eyebrow">УЧЕБНЫЙ ПРИМЕР</p><h1 id="page-title" tabIndex={-1}>{quest.title}</h1><p className="lead">{quest.description}</p><Meta quest={quest} /><p className="primary-venue">Основная площадка: <strong>{quest.primaryVenue}</strong></p>
      <div className="commerce-note"><strong>Локальный демонстрационный просмотр</strong><p>Продажи и копирование не подключены. Цена не установлена; этот пример нельзя купить.</p></div>
      <Link className="button demo-link" id="try-demo" to={`/quests/${quest.slug}/demo`} state={{ catalogUrl: location.state?.catalogUrl, catalogKey: location.state?.catalogKey, detailsKey: location.key }}>Попробовать задание <span aria-hidden="true">→</span></Link><a className="inline-link" href="#compatibility">Проверить совместимость ↓</a>
    </div></section>
    <section className="compatibility" id="compatibility"><p className="eyebrow">ПОДОЙДЁТ ВАШЕЙ КОМПАНИИ?</p><h2>Условия учебного сценария</h2><p>Все характеристики ниже относятся к вымышленному примеру, а не к доступному для покупки товару.</p><dl>{compatibility.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <div className="detail-sections"><section><h2>Что входит</h2><ul>{quest.includes.map(item => <li key={item}>{item}</li>)}</ul><p className="muted">Файлы для скачивания в этой витрине не выдаются.</p></section><section><h2>Что подготовить</h2><ul>{quest.prepare.map(item => <li key={item}>{item}</li>)}</ul><p>{quest.props}.</p></section><section><h2>Как адаптировать</h2><p>{quest.adaptation}</p></section><section><h2>Условия использования</h2><p>Это описание продуктовой модели, не утверждённая лицензия и не оферта. Коммерческие и юридические условия будут определены отдельно.</p><p>Организация приобретает контент независимо от подписки. Для одного открытого квеста достаточно Free; в команде Free — одно место. Повторные проведения не тарифицируются.</p><p>Покупка и черновик не открывают квест автоматически. Подготовленный квест открывается отдельно в приложении.</p></section></div>
    <Help />
  </>
}
