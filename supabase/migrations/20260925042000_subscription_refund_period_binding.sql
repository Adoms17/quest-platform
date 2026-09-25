begin;
create table public.subscription_refund_period_bindings (
 request_id uuid primary key references public.subscription_refund_requests(id),
 period_order_id uuid not null,
 kind text not null check(kind in ('confirmed','after_trial')),
 plan_version_id uuid not null references public.billing_plan_versions(id),
 period_start timestamptz not null,
 period_end timestamptz not null check(period_end>period_start)
);
alter table public.subscription_refund_period_bindings enable row level security;
revoke all on public.subscription_refund_period_bindings from public,anon,authenticated,service_role;
create trigger subscription_refund_binding_immutable before update or delete or truncate
 on public.subscription_refund_period_bindings for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.bind_subscription_refund_period(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.subscription_refund_requests%rowtype; o public.billing_sandbox_orders%rowtype;
 confirmed public.billing_period_confirmations%rowtype; paid public.billing_trial_paid_periods%rowtype;
 kind text; bound_order uuid;
begin
 select * into r from public.subscription_refund_requests where id=p_request_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 -- Serialize with period fulfillment (subscription first, then payment order).
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into o from public.billing_sandbox_orders where id=r.order_id for update;
 if exists(select 1 from public.subscription_refund_period_bindings where request_id=r.id) then return; end if;
 select * into confirmed from public.billing_period_confirmations where confirmation_id=o.id;
 select * into paid from public.billing_trial_paid_periods where order_id=o.id;
 if paid.order_id is not null then
  if paid.organization_id is distinct from r.organization_id or paid.plan_version_id is distinct from o.plan_version_id
   or paid.period_start is distinct from o.period_start or paid.period_end is distinct from o.period_end then
   raise exception 'subscription refund period mismatch' using errcode='55000'; end if;
  kind:='after_trial'; bound_order:=paid.order_id;
 elsif confirmed.confirmation_id is not null then
  if confirmed.organization_id is distinct from r.organization_id
   or (confirmed.request->>'plan')::uuid is distinct from o.plan_version_id
   or (confirmed.request->>'start')::timestamptz is distinct from o.period_start
   or (confirmed.request->>'end')::timestamptz is distinct from o.period_end then
   raise exception 'subscription refund period mismatch' using errcode='55000'; end if;
  kind:='confirmed'; bound_order:=confirmed.confirmation_id;
 else
  raise exception 'subscription refund period not issued' using errcode='55000';
 end if;
 insert into public.subscription_refund_period_bindings(request_id,period_order_id,kind,plan_version_id,period_start,period_end)
 values(r.id,bound_order,kind,o.plan_version_id,o.period_start,o.period_end);
end; $$;
revoke all on function platform_private.bind_subscription_refund_period(uuid) from public,anon,authenticated,service_role;
-- Bind before reserving; failure rolls back both binding and reserve.
do $$
declare definition text; marker text:='perform public.require_platform_owner();';
begin
 definition:=pg_get_functiondef('public.reserve_platform_subscription_refund(uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund reserve marker missing'; end if;
 execute replace(definition,marker,marker||' perform platform_private.bind_subscription_refund_period(p_request_id);');
end; $$;
commit;
