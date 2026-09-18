import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import App from './App'
import './style.css'

const url = import.meta.env.VITE_ADMIN_SUPABASE_URL
const key = import.meta.env.VITE_ADMIN_SUPABASE_ANON_KEY
const client = url && key ? createClient(url, key, {
  auth: { storageKey: 'qvesta-admin-auth', storage: window.sessionStorage, detectSessionInUrl: false },
}) : null

createRoot(document.getElementById('root')).render(client
  ? <App client={client} />
  : <main><h1>Квеста — администрирование</h1><p role="alert">Среда администрирования не настроена. Обратитесь к оператору платформы.</p></main>)
