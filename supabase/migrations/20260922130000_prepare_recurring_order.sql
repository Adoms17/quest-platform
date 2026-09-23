begin;
create table public.billing_recurring_orders (
 id uuid primary key references public.billing_discount_reservations(order_id),
 consent_id uuid not null references public.billing_recurring_consents(id),
 organization_id uuid not null references public.organizations(id),
 source_order_id uuid not null references public.billing_sandbox_orders(id),
 plan_version_id uuid not null references public.billing_plan_versions(id),
 expected_revision bigint not null check(expected_revision>=0),
 period_start timestamptz not null check(isfinite(period_start)),
 period_end timestamptz not null check(isfinite(period_end) and period_end>period_start),
 quote jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,period_start)
);
alter table public.billing_recurring_orders enable row level security;
revoke all on public.billing_recurring_orders from public,anon,authenticated,service_role;
create trigger recurring_order_immutable before update or delete or truncate on public.billing_recurring_orders for each statement execute function public.prevent_billing_plan_version_mutation();
-- Подготовка расчёта, не разрешение отправить платёж. Отправитель обязан проверить условия повторно.
create function platform_private.prepare_recurring_order(p_consent_id uuid,p_period_start timestamptz,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_recurring_consents%rowtype; o public.billing_sandbox_orders%rowtype;
 s public.organization_subscriptions%rowtype; offer public.billing_sandbox_offers%rowtype;
 old public.billing_recurring_orders%rowtype; key text; new_order_id uuid:=gen_random_uuid(); amount jsonb; result jsonb; ends_at timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 if p_period_start is null or not isfinite(p_period_start) or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid recurring period' using errcode='22023'; end if;
 select * into c from public.billing_recurring_consents where id=p_consent_id;
 if not found then raise exception 'recurring consent unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.order_id::text,7350));
 select * into s from public.organization_subscriptions where organization_id=c.organization_id for update;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=c.organization_id)
 or exists(select 1 from public.billing_recurring_revocations where consent_id=c.id)
 or not exists(select 1 from public.billing_recurring_methods where consent_id=c.id) then raise exception 'recurring consent unavailable' using errcode='55000'; end if;
 select * into old from public.billing_recurring_orders where organization_id=c.organization_id and period_start=p_period_start;
 if found then
  if old.consent_id<>c.id or old.expected_revision<>p_expected_revision then raise exception 'recurring order conflict' using errcode='22023'; end if;
  return old.quote;
 end if;
 select * into o from public.billing_sandbox_orders where id=c.order_id and organization_id=c.organization_id;
 select * into offer from public.billing_sandbox_offers where id=o.offer_id and organization_id=c.organization_id and plan_version_id=o.plan_version_id;
 if not found or offer.period_months is null then raise exception 'recurring source terms unavailable' using errcode='55000'; end if;
 if s.revision is distinct from p_expected_revision or s.status is distinct from 'active' or s.plan_version_id is distinct from o.plan_version_id
 or s.period_end is distinct from p_period_start or s.cancel_at_period_end then raise exception 'recurring subscription changed' using errcode='40001'; end if;
 if not platform_private.tariff_allows_renewal(o.plan_version_id,clock_timestamp(),true)
 or not platform_private.tariff_allows_renewal(o.plan_version_id,p_period_start,true) then raise exception 'recurring support ended' using errcode='55000'; end if;
 if exists(select 1 from public.billing_discount_reservations where organization_id=c.organization_id and state='reserved')
 or exists(select 1 from public.billing_sandbox_orders where organization_id=c.organization_id and state<>'finished') then raise exception 'recurring checkout pending' using errcode='55000'; end if;
 select plan_key into key from public.billing_plan_versions where id=o.plan_version_id;
 ends_at:=((p_period_start at time zone 'Europe/Moscow')+make_interval(months=>offer.period_months)) at time zone 'Europe/Moscow';
 amount:=platform_private.reserve_renewal_discount(new_order_id,c.organization_id,key,offer.period_months,offer.amount_minor);
 if (amount->>'discount_applied')::boolean is distinct from true then
  amount:=jsonb_build_object('base_amount_minor',offer.amount_minor,'amount_minor',offer.amount_minor,'discount_bps',0,'discount_amount_minor',0,'requires_payment',true,'discount_applied',false);
  perform platform_private.reserve_full_price_checkout(new_order_id,c.organization_id,amount);
 end if;
 result:=amount||jsonb_build_object('order_id',new_order_id,'organization_id',c.organization_id,'plan_version_id',o.plan_version_id,'period_months',offer.period_months,'period_start',p_period_start,'period_end',ends_at,'currency','RUB','environment','sandbox');
 insert into public.billing_recurring_orders(id,consent_id,organization_id,source_order_id,plan_version_id,expected_revision,period_start,period_end,quote)
 values(new_order_id,c.id,c.organization_id,o.id,o.plan_version_id,p_expected_revision,p_period_start,ends_at,result);
 return result;
end; $$;
revoke all on function platform_private.prepare_recurring_order(uuid,timestamptz,bigint) from public,anon,authenticated,service_role;
commit;
