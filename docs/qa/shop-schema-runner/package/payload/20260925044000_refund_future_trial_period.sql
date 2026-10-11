begin;
-- Preserve purchase history; only the resolver excludes refunded future rights.
create view platform_private.active_trial_paid_periods as
 select p.* from public.billing_trial_paid_periods p
 where not exists(select 1 from public.subscription_refund_applications a where a.period_order_id=p.order_id);
revoke all on platform_private.active_trial_paid_periods from public,anon,authenticated,service_role;
do $$
declare signature text; definition text; marker text:='from public.billing_trial_paid_periods';
begin
 foreach signature in array array[
 'public.effective_trial_subscription(public.organization_subscriptions,timestamp with time zone)',
 'platform_private.protect_paid_trial_binding()'
 ] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position(marker in definition)=0 then raise exception 'active trial period marker missing'; end if;
 execute replace(definition,marker,'from platform_private.active_trial_paid_periods');
 end loop;
end; $$;
create function platform_private.apply_future_trial_subscription_refund(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; b public.subscription_refund_period_bindings%rowtype;
 f public.billing_sandbox_refunds%rowtype; s public.organization_subscriptions%rowtype;
 paid public.billing_trial_paid_periods%rowtype; a public.subscription_refund_applications%rowtype;
begin
 select * into r from public.subscription_refund_requests where id=p_request_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 select * into s from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into a from public.subscription_refund_applications where request_id=r.id;
 if found then return to_jsonb(a); end if;
 perform 1 from public.billing_sandbox_orders where id=r.order_id for update;
 select x.* into f from public.billing_sandbox_refunds x join public.subscription_refund_reservations l on l.refund_id=x.id where l.request_id=r.id for update of x;
 if f.id is null or f.state<>'succeeded' or f.provider_refund_id is null or f.first_sent_at is null
 or f.order_id<>r.order_id or f.amount_minor<>r.amount_minor
 or f.payment_id::text is distinct from r.snapshot->>'payment_id' then
 raise exception 'subscription refund not confirmed' using errcode='55000'; end if;
 select * into b from public.subscription_refund_period_bindings where request_id=r.id;
 select * into paid from public.billing_trial_paid_periods where order_id=b.period_order_id;
 if b.kind is distinct from 'after_trial' or paid.order_id is null
 or paid.organization_id is distinct from r.organization_id or paid.access_id is distinct from s.trial_access_id
 or paid.period_start is distinct from b.period_start or paid.period_end is distinct from b.period_end
 or paid.plan_version_id is distinct from b.plan_version_id or clock_timestamp()>=paid.period_start
 or s.status<>'trial' then
 raise exception 'subscription refund access review required' using errcode='55000'; end if;
 insert into public.subscription_refund_applications(request_id,refund_id,period_order_id,before_state,after_state)
 values(r.id,f.id,b.period_order_id,to_jsonb(s),to_jsonb(s)) returning * into a;
 return to_jsonb(a);
end; $$;
revoke all on function platform_private.apply_future_trial_subscription_refund(uuid) from public,anon,authenticated,service_role;
-- A replay may not acknowledge a refunded purchase as an active entitlement.
do $$
declare signature text; definition text; marker text:='begin';
begin
 foreach signature in array array['platform_private.fulfill_discount_payment(uuid)','platform_private.fulfill_zero_discount_checkout(uuid)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position(marker in definition)=0 then raise exception 'fulfillment guard marker missing'; end if;
 definition:=overlay(definition placing 'begin
 if exists(select 1 from public.subscription_refund_applications where period_order_id=p_order_id) then
 raise exception ''subscription period refunded'' using errcode=''55000''; end if;' from position(marker in definition) for length(marker));
 execute definition;
 end loop;
end; $$;
commit;
