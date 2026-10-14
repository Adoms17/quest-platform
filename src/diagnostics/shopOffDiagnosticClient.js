import { createClient } from '@supabase/supabase-js'
import { createDiagnosticClient, diagnosticEnvironment, diagnosticScope } from './shopOffDiagnostic'

// Isolated entry owns this client. Never import the normal App client here.
// SDK session restoration/refresh cannot escape the always-installed fetch guard.
export const supabase = createDiagnosticClient(createClient,
  import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  (...args) => globalThis.fetch(...args), diagnosticEnvironment, diagnosticScope)
