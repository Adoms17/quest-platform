import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createFiscalAcceptanceRuntime } from '../_shared/fiscalAcceptanceEndpoint.js'
Deno.serve(request => createFiscalAcceptanceRuntime(name => Deno.env.get(name), createClient)(request))
