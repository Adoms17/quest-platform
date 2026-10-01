-- Read-only evidence, NOT permission to deploy and NOT proof of drained Edge requests.
-- No identifiers, payloads, cron commands, URLs, tokens or customer data are returned.
begin read only;
set local statement_timeout='20s';
select jsonb_build_object(
 'edge_drain_verified',false,
 'active_cron_jobs',(select count(*) from cron.job where active),
 'active_reconciliation_leases',(select count(*) from public.billing_sandbox_reconciliation_jobs where lease_until>clock_timestamp()),
 'order_states',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from public.billing_sandbox_orders group by state) s),
 'refund_states',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from public.billing_sandbox_refunds group by state) s),
 'fiscal_states',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from public.billing_subscription_fiscal_operation_status group by state) s),
 'enabled_settlement_schedules',(select count(*) from public.billing_sandbox_settlement_schedule where enabled)
);
rollback;
