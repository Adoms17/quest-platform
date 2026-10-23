import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import PublicMarket from './PublicMarket'
import { createPublicCatalogAdapter } from './publicCatalog'
import './styles.css'

// Local, opt-in QA fixtures only. Never enabled in the production bundle.
let adapter = createPublicCatalogAdapter()
let App = PublicMarket
if (import.meta.env.DEV && (new URLSearchParams(window.location.search).has('__qa') || __LOCAL_SNAPSHOT_PREVIEW__)) {
  const { createCatalogAdapter } = await import('./catalogData')
  const { fixtures } = await import('./fixtures')
  App = (await import('./App')).default
  adapter = createCatalogAdapter()
  const scenario = new URLSearchParams(window.location.search).get('__qa')
  let failed = false
  if (scenario === 'error') adapter = createCatalogAdapter({ fail: () => { if (failed) return false; failed = true; return true } })
  if (scenario === 'demo-error') adapter = createCatalogAdapter({ fail: ({ resource }) => { if (resource !== 'demo' || failed) return false; failed = true; return true } })
  if (scenario === 'empty') adapter = createCatalogAdapter({ items: [] })
  if (scenario === 'loading') adapter = createCatalogAdapter({ delay: 2500 })
  if (scenario === 'network') adapter = createCatalogAdapter({ delay: 1500, fail: () => !navigator.onLine })
  if (scenario === 'long') adapter = createCatalogAdapter({ items: fixtures.map((item, index) => index ? item : { ...item, title: `Учебная история ${'Длинноеназвание'.repeat(20)}` }) })
}
if (import.meta.env.DEV && __LOCAL_SNAPSHOT_PREVIEW__) {
  const { createSnapshotPreviewAdapter } = await import('./snapshotPreviewAdapter')
  adapter = createSnapshotPreviewAdapter()
}
window.history.scrollRestoration = 'manual'
createRoot(document.getElementById('root')).render(<StrictMode><BrowserRouter><App adapter={adapter} /></BrowserRouter></StrictMode>)
