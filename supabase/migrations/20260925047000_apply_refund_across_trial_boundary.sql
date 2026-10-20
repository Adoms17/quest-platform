begin;
-- One closed entry point; all transitions roll back if refund validation fails.
create function platform_private.apply_subscription_refund(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; b public.subscription_refund_period_bindings%rowtype;
 s public.organization_subscriptions%rowtype; a public.subscription_refund_applications%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
 raise exception 'subscription refund requires read committed' using errcode='40001'; end if;
 select * into r from public.subscription_refund_requests where id=p_request_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 select * into s from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into a from public.subscription_refund_applications where request_id=r.id;
 if found then return to_jsonb(a); end if;
 select * into b from public.subscription_refund_period_bindings where request_id=r.id;
 if b.request_id is null then raise exception 'subscription refund access review required' using errcode='55000'; end if;
 if b.kind='after_trial' then
  if clock_timestamp()<b.period_start then
   return platform_private.apply_future_trial_subscription_refund(r.id);
  end if;
  if s.trial_access_id is not null then
   if not exists(select 1 from platform_private.active_trial_paid_periods p
    where p.order_id=b.period_order_id and p.organization_id=r.organization_id
    and p.access_id=s.trial_access_id and p.plan_version_id=b.plan_version_id
    and p.period_start=b.period_start and p.period_end=b.period_end) then
    raise exception 'subscription refund access review required' using errcode='55000'; end if;
   perform public.advance_organization_trial(r.organization_id);
  end if;
 end if;
 return platform_private.apply_current_subscription_refund(r.id);
end; $$;
revoke all on function platform_private.apply_subscription_refund(uuid) from public,anon,authenticated,service_role;
commit;
