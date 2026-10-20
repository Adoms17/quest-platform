import { Link } from 'react-router-dom'
import { rangeLabel } from './fixtures'

import Icon from './Icon'
export { Icon }
export function Cover({ quest }) {
  return <div className={`cover ${quest.tone}`} aria-hidden="true">
    <span className="cover-label">УЧЕБНАЯ ИСТОРИЯ</span><span className="orbit orbit-one" /><span className="orbit orbit-two" />
    <span className="cover-symbol"><Icon name={quest.icon} /></span>
    <span className="cover-caption">{quest.tone === 'attic' ? 'У каждой тайны есть ключ' : quest.tone === 'stars' ? 'Большие открытия рядом' : 'Замечайте удивительное'}</span>
    <span className="cover-spark">✦</span>
  </div>
}
export function Meta({ quest }) {
  return <ul className="meta"><li><span className="icon-disc lime"><Icon name="users" /></span>{rangeLabel(quest.age)} лет</li><li><span className="icon-disc blue"><Icon name="clock" /></span>{rangeLabel(quest.minutes)} мин</li><li><span className="icon-disc coral"><Icon name="users" /></span>{rangeLabel(quest.group)} игроков</li></ul>
}
export function Status({ status, retry, resource = 'catalog', preview = false }) {
  if (preview && status === 'error') return <section className="status-panel" role="alert"><h2>Локальный snapshot не загружен</h2><p>Файл отсутствует, недоступен, невалиден или manifest/version не поддерживается. Fixtures не подставлены.</p><button id="catalog-retry" className="button" onClick={retry}>Повторить загрузку</button></section>
  const labels = { catalog: ['Загружаем учебный каталог…', 'Не удалось загрузить каталог', 'Попробуйте ещё раз. Ваши условия поиска сохранены в адресе страницы.'], details: ['Загружаем описание примера…', 'Не удалось загрузить описание', 'Можно повторить загрузку или вернуться в каталог.'], demo: ['Загружаем учебное демо…', 'Не удалось загрузить демо', 'Это ошибка загрузки, а не неверный ответ. Настоящая попытка не создана. Повторите загрузку или вернитесь к описанию.'] }[resource]
  if (status === 'loading') return <section className="status-panel" role="status"><span className="loading-dot" />{labels[0]}</section>
  if (status === 'error') return <section className="status-panel" role="alert"><h2>{labels[1]}</h2><p>{labels[2]}</p><button id="catalog-retry" className="button" onClick={retry}>Повторить загрузку</button></section>
  return null
}
export function WithdrawnExample({ quest, backTo = '/', catalogKey }) {
  return <section className="status-panel"><p className="eyebrow">УЧЕБНОЕ СОСТОЯНИЕ · СНЯТ С ВИТРИНЫ</p><h1 id="page-title" tabIndex={-1}>Этот пример снят с витрины</h1><p>{quest.title} — вымышленный пример недоступного товара. Демо для него не предлагается.</p><p>Сведения о ваших покупках не загружаются; наличие или отсутствие доступа нам неизвестно.</p><Link className="button" to={backTo} state={{ restoreKey: catalogKey }}>Все квесты</Link><p><Link className="inline-link" to="/purchases">О разделе покупок — пока не подключён</Link></p></section>
}
export function Help() {
  return <section className="help-section" id="help" tabIndex={-1}><p className="eyebrow">ПОМОЖЕМ ВЫБРАТЬ</p><h2>Сначала — подходит ли вам история</h2>
    <p>Проверьте чтение, площадку и подготовку в деталях, затем попробуйте учебное задание.</p>
    <details><summary>Нужна ли подписка для покупки контента?</summary><p>Контент приобретается отдельно от подписки организации. Для одного открытого квеста достаточно Free. В этом локальном просмотре покупки недоступны.</p></details>
    <details><summary>Можно ли провести квест повторно?</summary><p>Повторные проведения не тарифицируются. Покупка и создание черновика не открывают квест автоматически: подготовка и открытие — отдельные действия в приложении.</p></details>
    <details><summary>Что доступно сейчас?</summary><p>Поиск по вымышленным примерам, детали и публичное демо. Вход, покупки, копирование, редактор адаптации и отправка обращений в витрине не подключены.</p></details>
  </section>
}
export function HowItWorks() {
  return <section id="how" className="how-section" tabIndex={-1}><p className="eyebrow">КАК ЭТО РАБОТАЕТ</p><h2>Выберите. Подготовьте. Проведите снова.</h2>
    <ol><li><strong>Найдите подходящую историю</strong><p>Сверьте возраст и условия. Попробуйте пример задания до решения о покупке.</p></li><li><strong>Подготовьте свою версию</strong><p>Будущая покупка контента — отдельно от подписки. Рабочая копия остаётся черновиком до открытия.</p></li><li><strong>Проведите, когда будете готовы</strong><p>Free: один открытый квест и одно место команды. Повторные проведения не тарифицируются.</p></li></ol>
    <p className="muted">Сейчас это локальная учебная витрина. Продажи и рабочие копии не подключены.</p>
  </section>
}
export function NotFound({ product = false }) {
  return <section className="status-panel"><p className="eyebrow">404</p><h1 id="page-title" tabIndex={-1}>{product ? 'Квест не найден' : 'Страница не найдена'}</h1><p>Проверьте адрес или выберите другой учебный пример в каталоге.</p><Link className="button" to="/">Все квесты</Link></section>
}
