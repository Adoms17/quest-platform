import { Link } from 'react-router-dom'
import { BackLink } from './navigation'

const labels = { unknown: 'Не указано', proposed: 'Предложено / не проверено', confirmed: 'Заявлено подтверждённым редактором' }
const display = value => Array.isArray(value) ? value.every(item => typeof item === 'number') ? value.join('–') : value.join('; ') : value
export function PreviewClaim({ claim, name, format = display }) {
  return <div className="preview-claim" data-claim={name} data-status={claim.status}>
    <span>{claim.value === null ? 'Не указано' : format(claim.value)}</span>
    <small> — {labels[claim.status]}</small>
  </div>
}
export function PreviewIdentity({ quest }) {
  const { manifest } = quest.preview
  return <aside className="snapshot-identity" aria-label="Происхождение локального снимка">
    <strong>Локальный preview · demo / unpublished · не товар</strong>
    <p>Не опубликован. Продажи отключены. Подтверждение редактора не означает независимую проверку.</p>
    <dl><dt>Snapshot / version ID</dt><dd>{manifest.versionId}</dd><dt>Source ID</dt><dd>{manifest.source.contentId}</dd><dt>Public content ID</dt><dd>{manifest.payloadContentId}</dd></dl>
  </aside>
}
export function PreviewCard({ quest, location }) {
  const { card, compatibility: p } = quest.preview.payload
  return <div className="card-content snapshot-preview">
    <p className="example-label">Локальный snapshot · demo / unpublished</p>
    <h2>{quest.title}</h2><PreviewClaim name="title" claim={card.title} />
    <PreviewClaim name="description" claim={card.description} />
    <dl>{[['Возраст', 'age'], ['Группа', 'group'], ['Игра, минут', 'playMinutes'], ['Подготовка, минут', 'preparationMinutes']].map(([label, key]) => <div key={key}><dt>{label}</dt><dd><PreviewClaim name={key} claim={p[key]} /></dd></div>)}</dl>
    <p>Публичные шаги подготовки отсутствуют. Площадки не сопоставлены с фильтрами.</p>
    <Link id={`quest-${quest.slug}`} className="button" to={`/quests/${quest.slug}`} state={{ catalogUrl: `/${location.search}`, catalogKey: location.key }}>Открыть локальный снимок</Link>
  </div>
}
const fields = [
  ['Аудитория', 'audience', 'card'], ['Теги', 'tags', 'card'], ['Состав', 'includes', 'card'],
  ['Возраст', 'age'], ['Чтение', 'reading'], ['Знания', 'knowledge'], ['Группа', 'group'],
  ['Игра, минут', 'playMinutes'], ['Подготовка, минут', 'preparationMinutes'],
  ['Устройства', 'devices'], ['Связь', 'connection'], ['GPS', 'gps'], ['Резерв связи', 'connectionFallback'],
  ['Печать', 'printing'], ['Реквизит', 'props'], ['Взрослый', 'adult'],
  ['Дома — условия', 'homeVenue'], ['На улице — условия', 'outdoorVenue'], ['Резерв погоды', 'weatherFallback'], ['Адаптация', 'adaptation'],
]
export function PreviewDetails({ quest, location }) {
  const { payload } = quest.preview
  return <div className="snapshot-preview">
    <BackLink to={location.state?.catalogUrl || '/'} state={{ restoreKey: location.state?.catalogKey }}>Все квесты</BackLink>
    <h1 id="page-title" tabIndex={-1}>{quest.title}</h1>
    <PreviewClaim name="title" claim={payload.card.title} /><PreviewClaim name="description" claim={payload.card.description} />
    <PreviewIdentity quest={quest} />
    <Link id="try-demo" className="button" to={`/quests/${quest.slug}/demo`} state={{ catalogUrl: location.state?.catalogUrl, catalogKey: location.state?.catalogKey, detailsKey: location.key }}>Посмотреть демо без проверки ответа</Link>
    <section className="compatibility"><h2>Условия из публичного снимка</h2><dl>{fields.map(([label, key, section = 'compatibility']) => <div key={key}><dt>{label}</dt><dd><PreviewClaim name={key} claim={payload[section][key]} format={key === 'printing' ? value => `${value.mode === 'required' ? 'Требуется' : 'Не требуется'}: ${value.details}` : display} /></dd></div>)}</dl></section>
    <h2>Подготовка и ресурсы</h2><p>Публичные шаги подготовки отсутствуют. Закрытые инструкции не загружаются.</p>
    <p>Схема параметров: не указано. Ресурсы: не указано. Цена, лицензия, права и пилот не подтверждены этим preview.</p>
  </div>
}
export function PreviewDemo({ quest, location }) {
  const demo = quest.preview.payload.demo.publicDemo
  return <div className="demo-page snapshot-preview">
    <BackLink to={`/quests/${quest.slug}`} state={{ ...location.state, restoreKey: location.state?.detailsKey }}>К описанию снимка</BackLink>
    <h1 id="page-title" tabIndex={-1}>{quest.title}: просмотр демо</h1>
    <PreviewIdentity quest={quest} />
    <p role="note">Демо неигровое (playable=false). Ответ не запрашивается и не проверяется; результата прохождения нет.</p>
    <section className="demo-task"><h2>Доступный вопрос</h2><PreviewClaim name="demo.question" claim={{ status: demo.status, value: demo.value?.question ?? null }} />
      <h2>Подсказка</h2><PreviewClaim name="demo.hint" claim={{ status: demo.status, value: demo.value?.hint ?? null }} /></section>
  </div>
}
