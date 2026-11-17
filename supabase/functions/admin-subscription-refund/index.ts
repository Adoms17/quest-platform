import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSubscriptionRefundRuntime } from '../_shared/subscriptionRefundRuntime.js'

Deno.serve(request => createSubscriptionRefundRuntime(name => Deno.env.get(name), createClient)(request))
