begin;
create table public.billing_recurring_cancellations (
 order_id uuid primary key references public.billing_recurring_orders(id),
 reason text not null check(reason in ('consent_revoked','sandbox_disabled','method_unavailable','subscription_changed','support_ended','reservation_released')),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.billing_recurring_cancellations enable row level security;
revoke all on public.billing_recurring_cancellations from public,anon,authenticated,service_role;
create trigger recurring_cancellation_immutable before update or delete or truncate on public.billing_recurring_cancellations for each statement execute function public.prevent_billing_plan_version_mutation();
-- Проверка внутри будущей транзакции отправителя. ready не является разрешением на HTTP после commit.
create function platform_private.review_recurring_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype; s public.organization_subscriptions%rowtype; reservation text; reason text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then raise exception 'recurring order unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 select * into s from public.organization_subscriptions where organization_id=r.organization_id for update;
 -- Любое начатое исполнение требует отдельной сверки; не освобождаем его резерв.
 if exists(select 1 from public.billing_sandbox_orders where id=r.id)
 or exists(select 1 from public.billing_period_confirmations where confirmation_id=r.id) then
 return jsonb_build_object('state','reconciliation_required'); end if;
 select c.reason into reason from public.billing_recurring_cancellations c where c.order_id=r.id;
 if found then return jsonb_build_object('state','cancelled','reason',reason); end if;
 select state into reservation from public.billing_discount_reservations where order_id=r.id;
 if reservation='consumed' then return jsonb_build_object('state','settled'); end if;
 if exists(select 1 from public.billing_recurring_revocations where consent_id=r.consent_id) then reason:='consent_revoked';
 elsif reservation='released' then reason:='reservation_released';
 elsif not exists(select 1 from public.billing_sandbox_application_scope where organization_id=r.organization_id) then reason:='sandbox_disabled';
 elsif not exists(select 1 from public.billing_recurring_methods where consent_id=r.consent_id) then reason:='method_unavailable';
 elsif s.revision is distinct from r.expected_revision or s.status is distinct from 'active'
 or s.plan_version_id is distinct from r.plan_version_id or s.period_end is distinct from r.period_start or s.cancel_at_period_end then reason:='subscription_changed';
 elsif not platform_private.tariff_allows_renewal(r.plan_version_id,clock_timestamp(),true)
 or not platform_private.tariff_allows_renewal(r.plan_version_id,r.period_start,true) then reason:='support_ended';
 end if;
 if reason is null then return jsonb_build_object('state','ready','requires_payment',(r.quote->>'requires_payment')::boolean); end if;
 if reservation='reserved' then perform platform_private.settle_discount_period(r.id,false); end if;
 insert into public.billing_recurring_cancellations(order_id,reason) values(r.id,reason);
 return jsonb_build_object('state','cancelled','reason',reason);
end; $$;
revoke all on function platform_private.review_recurring_order(uuid) from public,anon,authenticated,service_role;
commit;
