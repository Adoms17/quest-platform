import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { DIAGNOSTIC_PATH, diagnosticScope } from './diagnostics/shopOffDiagnostic'
import { RECOVERY_PATH } from './services/passwordRecovery'

const root = createRoot(document.getElementById('root'))
if (window.location.pathname === RECOVERY_PATH) {
  import('./recoveryEntry.jsx').then(({ default: RecoveryEntry }) => {
    root.render(<StrictMode><RecoveryEntry /></StrictMode>)
  })
} else if (window.location.pathname === DIAGNOSTIC_PATH) {
  // Do not mount App: its account activity, organization reads and offline sync
  // are unrelated side effects. Disabled/production entry never imports SDK.
  window.addEventListener('hashchange', diagnosticScope.close)
  window.addEventListener('popstate', diagnosticScope.close)
  if (diagnosticScope.allowed()) {
    import('./diagnostics/ShopOffDiagnostic.jsx').then(({ default: Diagnostic }) => {
      if (diagnosticScope.allowed()) root.render(<StrictMode><Diagnostic /></StrictMode>)
      else root.render(<p>Диагностическая страница недоступна.</p>)
    })
  } else root.render(<p>Диагностическая страница недоступна.</p>)
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(<StrictMode><App /></StrictMode>)
  })
}
