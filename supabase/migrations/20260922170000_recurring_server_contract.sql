begin;
create table public.billing_recurring_results (
 order_id uuid primary key references public.billing_recurring_attempts(order_id),
 payment_id uuid not null unique,
 status text not null check(status in ('pending','waiting_for_capture','succeeded','canceled')),
 paid boolean not null,
 requires_review boolean not null default false,
 checked_at timestamptz not null default clock_timestamp()
);
alter table public.billing_recurring_results enable row level security;
revoke all on public.billing_recurring_results from public,anon,authenticated,service_role;
create function platform_private.read_recurring_attempt(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'organizationId',r.organization_id,'planVersionId',r.plan_version_id,
 'environment','sandbox','shopId',a.shop_id,'amountMinor',a.amount_minor,'currency',a.currency,
 'idempotencyKey',a.idempotency_key,'firstSentAt',a.created_at,'providerMethodId',a.provider_method_id,'providerPaymentId',p.payment_id)
 from public.billing_recurring_orders r join public.billing_recurring_attempts a on a.order_id=r.id
 left join public.billing_recurring_results p on p.order_id=r.id where r.id=p_order_id;
$$;
create function platform_private.authorize_recurring_send(p_order_id uuid,p_key uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; s public.organization_subscriptions%rowtype; a public.billing_recurring_attempts%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 select * into s from public.organization_subscriptions where organization_id=r.organization_id for update;
 select * into a from public.billing_recurring_attempts where order_id=r.id;
 return coalesce(a.idempotency_key=p_key and clock_timestamp()>=a.created_at and clock_timestamp()<a.created_at+interval '23 hours'
 and s.revision=r.expected_revision and s.status='active' and s.plan_version_id=r.plan_version_id and s.period_end=r.period_start and not s.cancel_at_period_end
 and not exists(select 1 from public.billing_recurring_revocations where consent_id=r.consent_id)
 and exists(select 1 from public.billing_sandbox_application_scope where organization_id=r.organization_id)
 and exists(select 1 from public.billing_discount_reservations where order_id=r.id and state='reserved')
 and not exists(select 1 from public.billing_recurring_results where order_id=r.id)
 and platform_private.tariff_allows_renewal(r.plan_version_id,clock_timestamp(),true)
 and platform_private.tariff_allows_renewal(r.plan_version_id,r.period_start,true),false);
end; $$;
-- Только нормализованный результат после проверки API провайдера, не данные webhook/клиента.
create function platform_private.record_recurring_result(p_order_id uuid,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; old public.billing_recurring_results%rowtype; payment uuid; status text; paid boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 if p_payment->'test' is distinct from 'true'::jsonb or jsonb_typeof(p_payment->'paid') is distinct from 'boolean'
 or p_payment->>'status' is null or p_payment->>'status' not in ('pending','waiting_for_capture','succeeded','canceled') then raise exception 'invalid recurring result' using errcode='22023'; end if;
 payment:=(p_payment->>'paymentId')::uuid; status:=p_payment->>'status'; paid:=(p_payment->>'paid')::boolean;
 if payment is null or paid<>(status='succeeded') then raise exception 'invalid recurring result' using errcode='22023'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then raise exception 'recurring order unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=r.organization_id for update;
 if not exists(select 1 from public.billing_recurring_attempts where order_id=r.id) then raise exception 'recurring attempt unavailable' using errcode='22023'; end if;
 select * into old from public.billing_recurring_results where order_id=r.id for update;
 if not found then
 insert into public.billing_recurring_results(order_id,payment_id,status,paid) values(r.id,payment,status,paid);
 elsif old.payment_id<>payment or (old.status in ('succeeded','canceled') and status in ('succeeded','canceled') and old.status<>status) then
 update public.billing_recurring_results set requires_review=true,checked_at=clock_timestamp() where order_id=r.id;
 elsif old.status not in ('succeeded','canceled') and not (old.status='waiting_for_capture' and status='pending') then
 update public.billing_recurring_results set status=p_payment->>'status',paid=(p_payment->>'paid')::boolean,checked_at=clock_timestamp() where order_id=r.id;
 end if;
 select * into old from public.billing_recurring_results where order_id=r.id;
 return jsonb_build_object('paymentId',old.payment_id,'status',old.status,'paid',old.paid,'requiresReview',old.requires_review);
end; $$;
revoke all on function platform_private.read_recurring_attempt(uuid),platform_private.authorize_recurring_send(uuid,uuid),platform_private.record_recurring_result(uuid,jsonb) from public,anon,authenticated,service_role;
commit;
