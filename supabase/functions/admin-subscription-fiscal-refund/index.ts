import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSubscriptionFiscalRefundRuntime } from '../_shared/subscriptionFiscalRefundRuntime.js'
Deno.serve(request => createSubscriptionFiscalRefundRuntime(name => Deno.env.get(name), createClient)(request))
