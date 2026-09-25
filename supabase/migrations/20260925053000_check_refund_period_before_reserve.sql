begin;
create function platform_private.check_subscription_refund_access(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare request public.subscription_refund_requests%rowtype; binding public.subscription_refund_period_bindings%rowtype;
 subscription public.organization_subscriptions%rowtype; paid public.billing_trial_paid_periods%rowtype;
 trial public.billing_trial_access%rowtype; checked_at timestamptz:=clock_timestamp();
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 select * into request from public.subscription_refund_requests where id=p_request_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 select * into subscription from public.organization_subscriptions where organization_id=request.organization_id for update;
 select * into binding from public.subscription_refund_period_bindings where request_id=request.id;
 if binding.request_id is null or exists(select 1 from public.subscription_refund_applications where request_id=request.id)
 or subscription.scheduled_plan_version_id is not null then
 raise exception 'subscription refund access review required' using errcode='55000'; end if;
 if exists(select 1 from public.billing_recurring_orders ro join public.billing_recurring_dispatches d on d.order_id=ro.id
 where ro.organization_id=request.organization_id
 and not exists(select 1 from public.billing_period_confirmations c where c.confirmation_id=ro.id)
 and not exists(select 1 from public.billing_recurring_results p where p.order_id=ro.id and p.status='canceled' and not p.requires_review)) then
 raise exception 'subscription refund renewal reconciliation required' using errcode='55000'; end if;
 if binding.kind='after_trial' and subscription.trial_access_id is not null then
  select * into paid from platform_private.active_trial_paid_periods where order_id=binding.period_order_id;
  select * into trial from public.billing_trial_access where id=subscription.trial_access_id;
  if paid.order_id is null or paid.organization_id is distinct from request.organization_id
  or paid.access_id is distinct from trial.id or paid.generation is distinct from trial.generation
  or paid.plan_version_id is distinct from binding.plan_version_id
  or paid.period_start is distinct from binding.period_start or paid.period_end is distinct from binding.period_end
  or trial.ends_at is distinct from paid.period_start or trial.state not in ('active','scheduled')
  or not public.trial_access_matches(subscription,trial) then
   raise exception 'subscription refund access review required' using errcode='55000'; end if;
  if checked_at<paid.period_start then
   if subscription.status is distinct from 'trial' then raise exception 'subscription refund access review required' using errcode='55000'; end if;
   return;
  end if;
  -- Project the due transition without changing the trial, revision or audit.
  subscription:=public.effective_trial_subscription(subscription,checked_at);
  subscription.trial_access_id:=null;
 end if;
 if subscription.trial_access_id is not null or subscription.status not in ('active','expired')
 or subscription.plan_version_id is distinct from binding.plan_version_id
 or subscription.period_start is distinct from binding.period_start or subscription.period_end is distinct from binding.period_end
 or exists(select 1 from platform_private.active_trial_paid_periods where organization_id=request.organization_id and order_id<>binding.period_order_id and period_end>checked_at) then
 raise exception 'subscription refund access review required' using errcode='55000'; end if;
 if platform_private.current_tariff_version('free',checked_at) is null then raise exception 'current free tariff unavailable' using errcode='55000'; end if;
end; $$;
revoke all on function platform_private.check_subscription_refund_access(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; marker text:='if found then return existing; end if;';
begin
 definition:=pg_get_functiondef('public.reserve_platform_subscription_refund(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund access preflight marker missing'; end if;
 execute replace(definition,marker,marker||' perform platform_private.check_subscription_refund_access(request.id);');
end; $$;
commit;
