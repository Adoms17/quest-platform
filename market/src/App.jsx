import { Link, NavLink, Route, Routes } from 'react-router-dom'
import Catalog from './Catalog'
import Details from './Details'
import Demo from './Demo'
import { NavigationProvider } from './navigation'
import { usePagePosition } from './usePagePosition'
import { NotFound } from './ui'
import { purchasesDestination } from './appDestination'

function Purchases() {
  usePagePosition(true, 'Мои покупки')
  const destination = purchasesDestination(import.meta.env.VITE_APP_ORIGIN)
  return <section className="status-panel purchases"><p className="eyebrow">Мои покупки</p><h1 id="page-title" tabIndex={-1}>Квесты вашей организации</h1><p>Покупки и рабочие копии доступны в приложении. Войдите и выберите организацию, которая приобрела квест.</p><p>В приложении можно создать закрытую копию и открыть её в редакторе. Продажи в этой витрине пока не подключены.</p>{destination ? <a className="button" href={destination}>Открыть мои покупки</a> : <p role="status">Переход в приложение для этой витрины ещё не настроен.</p>}<Link className="inline-link" to="/">Посмотреть каталог</Link></section>
}
function Missing() { usePagePosition(true, 'Страница не найдена'); return <NotFound /> }
export default function App({ adapter }) {
  return <NavigationProvider><a className="skip-link" href="#main">Перейти к содержимому</a><div className="preview-banner">Учебная витрина <span>·</span> Покупки и вход не подключены</div>
    <header className="site-header wrap"><Link to="/" className="brand" aria-label="Квеста — каталог"><img src="/assets/logo.png" alt="" />Квеста</Link><nav aria-label="Основная навигация"><NavLink to="/" end>Готовые квесты</NavLink><Link to="/#how">Как это работает</Link><NavLink to="/purchases">Мои покупки</NavLink></nav><span className="account-state">Вход не подключён</span></header>
    <main id="main" className="wrap" tabIndex={-1}><Routes><Route path="/" element={<Catalog adapter={adapter} />} /><Route path="/quests/:slug" element={<Details adapter={adapter} />} /><Route path="/quests/:slug/demo" element={<Demo adapter={adapter} />} /><Route path="/purchases" element={<Purchases />} /><Route path="*" element={<Missing />} /></Routes></main>
    <footer className="site-footer wrap"><Link className="brand" to="/"><img src="/assets/logo.png" alt="" />Квеста</Link><p>Идеи становятся приключениями.</p><nav aria-label="Другие сервисы Квесты"><a href={import.meta.env.DEV ? 'http://127.0.0.1:4187/' : 'https://qvesta.ru/'}>О сервисе</a><a href="https://app.qvesta.ru/quests">Открыть приложение</a></nav><p>Локальный просмотр · без продаж</p></footer>
  </NavigationProvider>
}
