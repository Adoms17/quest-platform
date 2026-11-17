begin;
create table public.subscription_refund_reservations (
 request_id uuid primary key references public.subscription_refund_requests(id),
 refund_id uuid not null unique references public.billing_sandbox_refunds(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.subscription_refund_reservations enable row level security;
revoke all on public.subscription_refund_reservations from public,anon,authenticated,service_role;
create trigger subscription_refund_reservation_immutable before update or delete or truncate
 on public.subscription_refund_reservations for each statement execute function public.prevent_billing_plan_version_mutation();
create function public.reserve_platform_subscription_refund(p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare request public.subscription_refund_requests%rowtype; existing uuid;
 o public.billing_sandbox_orders%rowtype; payment public.billing_sandbox_payment_results%rowtype;
 refunded bigint; pending bigint; result uuid;
begin
 perform public.require_platform_owner();
 select * into request from public.subscription_refund_requests where id=p_request_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 -- Same lock as legacy refund reservations: one shared payment balance.
 select * into o from public.billing_sandbox_orders where id=request.order_id for update;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=request.organization_id) then
  raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
 select refund_id into existing from public.subscription_refund_reservations where request_id=request.id;
 if found then return existing; end if;
 select * into payment from public.billing_sandbox_payment_results where order_id=o.id;
 if payment.order_id is null or payment.status<>'succeeded' or not payment.paid or payment.requires_review
 or payment.payment_id::text is distinct from request.snapshot->>'payment_id'
 or o.organization_id<>request.organization_id or o.amount_minor<>(request.snapshot->>'paid_minor')::bigint
 or o.period_start<>(request.snapshot->>'period_start')::timestamptz
 or o.period_end<>(request.snapshot->>'period_end')::timestamptz then
  raise exception 'subscription refund snapshot changed' using errcode='22023'; end if;
 select coalesce(sum(amount_minor) filter(where state='succeeded'),0),
  coalesce(sum(amount_minor) filter(where state not in ('succeeded','canceled','rejected')),0)
 into refunded,pending from public.billing_sandbox_refunds where order_id=o.id;
 if pending>0 then raise exception 'subscription refund pending' using errcode='55000'; end if;
 if refunded<>(request.snapshot->>'refunded_minor')::bigint then
  raise exception 'subscription refund balance changed' using errcode='55000'; end if;
 if request.amount_minor<=0 or request.amount_minor>o.amount_minor-refunded then
  raise exception 'invalid refund amount' using errcode='22023'; end if;
 if request.amount_minor<o.amount_minor-refunded and
 (request.amount_minor<100 or o.amount_minor-refunded-request.amount_minor<100) then
  raise exception 'refund provider amount limits' using errcode='22023'; end if;
 insert into public.billing_sandbox_refunds(order_id,actor_id,command_id,amount_minor,payment_id)
 values(o.id,auth.uid(),request.id,request.amount_minor,payment.payment_id) returning id into result;
 insert into public.subscription_refund_reservations(request_id,refund_id) values(request.id,result);
 return result;
end; $$;
revoke all on function public.reserve_platform_subscription_refund(uuid) from public,anon,authenticated,service_role;
-- Fail closed even if an old operator attempts to send the new shared reserve.
-- Replace only when period application and reconciliation are ready.
create function platform_private.block_unintegrated_subscription_refund() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.subscription_refund_reservations where refund_id=old.id) then
  raise exception 'subscription refund execution not enabled' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function platform_private.block_unintegrated_subscription_refund() from public,anon,authenticated,service_role;
create trigger block_unintegrated_subscription_refund before update on public.billing_sandbox_refunds
 for each row execute function platform_private.block_unintegrated_subscription_refund();
commit;
