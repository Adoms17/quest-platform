begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
-- Caller must set qvesta.settlement_order_id and qvesta.settlement_schedule_mode.
-- Preview always rolls back. Commit is a separate, explicitly approved wrapper step.
do $admission$
declare target uuid:=current_setting('qvesta.settlement_order_id')::uuid;
 mode text:=current_setting('qvesta.settlement_schedule_mode');
 o public.billing_sandbox_orders%rowtype;
 q public.billing_sandbox_settlement_schedule%rowtype;
begin
 if mode not in ('preview','provision') then raise exception 'invalid schedule mode'; end if;
 perform platform_private.require_sandbox_environment();
 if target<>'37ca8401-9ceb-4b50-985b-31c6e8aff131'::uuid then raise exception 'postguard target denied'; end if;
 perform pg_advisory_xact_lock(30092026,3);
 select * into q from public.billing_sandbox_settlement_schedule where order_id=target for update;
 select * into strict o from public.billing_sandbox_orders where id=target for update;
 if not exists(select 1 from public.billing_fiscal_acceptance_fixtures f
  where f.id=md5('stage-guard-fixture-20261002')::uuid and f.order_id=o.id
  and f.organization_id=o.organization_id and f.plan_version_id=o.plan_version_id)
  or o.organization_id<>md5('stage-guard-org-20261002')::uuid
  or o.shop_id<>'1467641' or o.currency<>'RUB' or o.amount_minor<>99000
  or o.period_start is null or o.period_end is null
  or o.period_end-o.period_start<>interval '30 minutes'
  or o.period_end+interval '24 hours'<=clock_timestamp()
  or not exists(select 1 from public.billing_subscription_fiscal_terms t
   join public.billing_fiscal_policy_models m on m.policy_id=t.policy_id
   where t.order_id=o.id and t.period_start=o.period_start and t.period_end=o.period_end
    and m.model_version='subscription_access_v1' and m.settlement_basis='period_end')
  or not exists(select 1 from public.billing_sandbox_payment_results p
   join public.billing_receipt_payment_status r on r.order_id=p.order_id and r.payment_id=p.payment_id
   where p.order_id=o.id and p.shop_id=o.shop_id and p.status='succeeded'
    and p.paid and not p.requires_review and r.status='succeeded')
  or not exists(select 1 from public.billing_sandbox_application_scope where organization_id=o.organization_id)
  or exists(select 1 from public.billing_sandbox_refunds where order_id=o.id and state not in ('canceled','rejected'))
  or exists(select 1 from public.billing_prepayment_settlement_status where order_id=o.id)
  or exists(select 1 from public.billing_subscription_fiscal_operations where order_id=o.id)
  or exists(select 1 from public.billing_sandbox_settlement_schedule where enabled)
 then raise exception 'schedule admission denied'; end if;
 if q.order_id is not null then
  if q.amount_minor<>o.amount_minor or q.period_end<>o.period_end
   or (q.expires_at<=clock_timestamp() or q.expires_at>o.period_end+interval '24 hours') or q.attempts<>0
   or q.last_request_id is not null or q.stop_reason is not null then
   raise exception 'existing schedule changed: manual review required';
  end if;
 else
  insert into public.billing_sandbox_settlement_schedule(order_id,amount_minor,period_end,expires_at,next_check_at)
  values(o.id,o.amount_minor,o.period_end,least(clock_timestamp()+interval '30 minutes',o.period_end+interval '24 hours'),o.period_end);
 end if;
end; $admission$;
select order_id,amount_minor,period_end,expires_at,enabled,attempts
 from public.billing_sandbox_settlement_schedule where order_id=current_setting('qvesta.settlement_order_id')::uuid;
rollback;
