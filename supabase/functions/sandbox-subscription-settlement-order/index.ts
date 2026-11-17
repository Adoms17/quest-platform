import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSubscriptionSettlementOrderRuntime } from '../_shared/subscriptionSettlementOrderRuntime.js'
Deno.serve(request => createSubscriptionSettlementOrderRuntime(name => Deno.env.get(name), createClient)(request))
