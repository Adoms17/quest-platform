import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { purchasesDestination } from './appDestination'
import { NavigationProvider } from './navigation'
import { usePagePosition } from './usePagePosition'
import PublicCatalog from './PublicCatalogPage'
import PublicDetails from './PublicDetails'

function Missing() {
  usePagePosition(true, 'Страница не найдена', 'магазин')
  return <section className="status-panel"><h1 id="page-title" tabIndex={-1}>Страница не найдена</h1><Link className="button" to="/">Все квесты</Link></section>
}
export default function PublicMarket({ adapter }) {
  const app = purchasesDestination(import.meta.env.VITE_APP_ORIGIN)
  return <NavigationProvider><div className="public-market"><a className="skip-link" href="#main">Перейти к содержимому</a><header className="site-header wrap"><Link to="/" className="brand" aria-label="Квеста — каталог"><img src="/assets/logo.png" alt="" />Квеста</Link><nav aria-label="Основная навигация"><NavLink to="/" end>Каталог</NavLink>{app && <a href={app}>Мои покупки</a>}</nav></header><main id="main" className="wrap" tabIndex={-1}><Routes><Route path="/" element={<PublicCatalog adapter={adapter} />} /><Route path="/quests/:slug" element={<PublicDetails adapter={adapter} />} /><Route path="/quests/:slug/demo" element={<PublicDetails adapter={adapter} demo />} /><Route path="*" element={<Missing />} /></Routes></main><footer className="site-footer wrap"><p>Квеста · готовые квесты</p><p>Покупки и рабочие копии — в приложении вашей организации.</p></footer></div></NavigationProvider>
}
