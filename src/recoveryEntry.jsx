import { createClient } from '@supabase/supabase-js'
import PasswordRecovery from './pages/PasswordRecovery'
import { createPasswordRecovery } from './services/passwordRecovery'

// Separate from the persisted app session: no background sync or account reads.
const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit', detectSessionInUrl: false, persistSession: false, autoRefreshToken: false, storageKey: 'qvesta-recovery' },
})
const recovery = createPasswordRecovery(client.auth, window.location, window.history)
export default function RecoveryEntry() { return <PasswordRecovery recovery={recovery} /> }
