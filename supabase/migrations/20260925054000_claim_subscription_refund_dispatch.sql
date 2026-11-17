begin;
create table public.subscription_refund_dispatches (
 refund_id uuid primary key references public.billing_sandbox_refunds(id),
 actor_id uuid not null references auth.users(id),
 authorized_at timestamptz not null default clock_timestamp()
);
alter table public.subscription_refund_dispatches enable row level security;
revoke all on public.subscription_refund_dispatches from public,anon,authenticated,service_role;
create trigger subscription_refund_dispatch_immutable before update or delete or truncate on public.subscription_refund_dispatches
 for each statement execute function public.prevent_billing_plan_version_mutation();
-- The legacy sender still cannot start a new subscription refund without this receipt.
do $$
declare definition text; marker text:='if exists(select 1 from public.subscription_refund_reservations where refund_id=old.id) then';
begin
 definition:=pg_get_functiondef('platform_private.block_unintegrated_subscription_refund()'::regprocedure);
 if position(marker in definition)=0 then raise exception 'refund dispatch gate marker missing'; end if;
 execute replace(definition,marker,marker||'
 if old.state=''reserved'' and old.first_sent_at is null and old.provider_refund_id is null
 and new.state=''sending'' and new.first_sent_at is not null
 and (to_jsonb(new)-''state''-''updated_at''-''first_sent_at'')=(to_jsonb(old)-''state''-''updated_at''-''first_sent_at'')
 and exists(select 1 from public.subscription_refund_dispatches d where d.refund_id=old.id and d.authorized_at=new.first_sent_at) then return new; end if;');
end; $$;
create function platform_private.claim_subscription_refund_dispatch(p_refund_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.subscription_refund_requests%rowtype; refund public.billing_sandbox_refunds%rowtype;
 payment public.billing_sandbox_payment_results%rowtype; order_row public.billing_sandbox_orders%rowtype;
 authorized timestamptz; used bigint;
begin
 perform public.require_platform_owner();
 select r.* into request from public.subscription_refund_requests r join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id=p_refund_id;
 if not found then raise exception 'subscription refund request missing' using errcode='22023'; end if;
 perform 1 from public.organization_subscriptions where organization_id=request.organization_id for update;
 select * into order_row from public.billing_sandbox_orders where id=request.order_id for update;
 select * into refund from public.billing_sandbox_refunds where id=p_refund_id for update;
 if exists(select 1 from public.subscription_refund_dispatches where refund_id=refund.id)
 or refund.state<>'reserved' or refund.first_sent_at is not null or refund.provider_refund_id is not null then
 return jsonb_build_object('can_send',false,'refund_id',refund.id); end if;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=request.organization_id) then
 raise exception 'sandbox refund scope denied' using errcode='42501'; end if;
 perform platform_private.check_subscription_refund_access(request.id);
 select * into payment from public.billing_sandbox_payment_results where order_id=order_row.id;
 if payment.order_id is null or payment.status<>'succeeded' or not payment.paid or payment.requires_review
 or payment.payment_id is distinct from refund.payment_id or payment.payment_id::text is distinct from request.snapshot->>'payment_id'
 or refund.order_id<>request.order_id or refund.amount_minor<>request.amount_minor
 or order_row.organization_id<>request.organization_id or order_row.currency<>'RUB'
 or order_row.amount_minor is distinct from (request.snapshot->>'paid_minor')::bigint
 or order_row.period_start is distinct from (request.snapshot->>'period_start')::timestamptz
 or order_row.period_end is distinct from (request.snapshot->>'period_end')::timestamptz then
 raise exception 'subscription refund snapshot changed' using errcode='55000'; end if;
 select coalesce(sum(amount_minor),0) into used from public.billing_sandbox_refunds where order_id=order_row.id and state not in ('canceled','rejected');
 if used>order_row.amount_minor or refund.amount_minor<=0 then raise exception 'invalid refund amount' using errcode='22023'; end if;
 insert into public.subscription_refund_dispatches(refund_id,actor_id) values(refund.id,auth.uid()) returning authorized_at into authorized;
 update public.billing_sandbox_refunds set state='sending',first_sent_at=authorized,updated_at=authorized where id=refund.id;
 return jsonb_build_object('can_send',true,'refund_id',refund.id,'idempotency_key',refund.id,
 'payment_id',refund.payment_id,'amount_minor',refund.amount_minor,'currency',order_row.currency,'shop_id',order_row.shop_id);
end; $$;
revoke all on function platform_private.claim_subscription_refund_dispatch(uuid) from public,anon,authenticated,service_role;
commit;
