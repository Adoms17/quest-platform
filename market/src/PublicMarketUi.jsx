import Icon from './Icon'
import { claim, display } from './publicCatalogView'
import { formatShopAmount } from '../../src/services/shopMoney'

export function PublicStatus({ state, resource = 'каталог' }) {
  if (state.status === 'ready') return null
  return <section className="status-panel" role={state.status === 'error' ? 'alert' : 'status'}>
    {state.status === 'loading' ? <p>Загружаем {resource}…</p> : <><h2>Не удалось загрузить {resource}</h2><p>Повторите запрос. Ваши условия поиска сохранены в адресе страницы.</p><button id="catalog-retry" className="button" onClick={state.retry}>Повторить загрузку</button></>}
  </section>
}
export function PublicMedia() {
  return <div className="public-media"><Icon name="map" /><span>Обложка не опубликована</span></div>
}
export function PublicMeta({ item }) {
  const fields = [['age', 'Возраст', 'лет', 'users', 'lime'], ['playMinutes', 'Время игры', 'мин', 'clock', 'blue'], ['group', 'Группа', 'игроков', 'users', 'coral']]
  return <ul className="meta">{fields.map(([key, label, unit, icon, color]) => {
    const value = claim(item, 'compatibility', key)
    return <li key={key}><span className={`icon-disc ${color}`}><Icon name={icon} /></span><span><span className="sr-only">{label}: </span>{value ? `${display(value)} ${unit}` : `${label}: не указано`}</span></li>
  })}</ul>
}
export function PublicPrice({ offer }) {
  return <p className="public-price"><strong>{formatShopAmount(offer.amount_minor, offer.currency)} {offer.currency}</strong><span>разово</span></p>
}
