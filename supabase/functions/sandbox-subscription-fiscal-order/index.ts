import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSubscriptionFiscalOrderRuntime } from '../_shared/subscriptionFiscalOrderWorker.js'
Deno.serve(request => createSubscriptionFiscalOrderRuntime(name => Deno.env.get(name), createClient)(request))
