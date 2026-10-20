import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSubscriptionRefundRuntime } from '../_shared/subscriptionRefundRuntime.js'
import { createSubscriptionRefundPreparationEndpoint } from '../_shared/subscriptionRefundPreparationEndpoint.js'

Deno.serve(request => createSubscriptionRefundRuntime(name => Deno.env.get(name), createClient, createSubscriptionRefundPreparationEndpoint)(request))
