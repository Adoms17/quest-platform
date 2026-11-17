begin;
-- Закрытый журнал: один заказ резервирует один льготный расчётный период.
-- Внешний checkout ещё должен передать проверенные сервером цену и период.
create table public.billing_discount_reservations (
 order_id uuid primary key,
 discount_id uuid not null references public.billing_discount_codes(id),
 organization_id uuid not null references public.organizations(id),
 request jsonb not null,
 quote jsonb not null,
 state text not null default 'reserved' check(state in ('reserved','consumed','released')),
 created_at timestamptz not null default clock_timestamp(), settled_at timestamptz
);
alter table public.billing_discount_reservations enable row level security;
revoke all on public.billing_discount_reservations from public,anon,authenticated,service_role;
create function platform_private.reserve_discount_period(p_order_id uuid,p_organization_id uuid,p_discount_id uuid,
 p_plan_key text,p_period_months integer,p_base_minor bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code public.billing_discount_codes%rowtype; previous public.billing_discount_reservations%rowtype;
 payload jsonb; amount jsonb; used integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_order_id is null or p_organization_id is null or p_discount_id is null then raise exception 'invalid discount reservation' using errcode='22023'; end if;
 -- Порядок блокировок одинаков для резервирования и завершения.
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,8201));
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,8202));
 payload:=jsonb_build_object('organization_id',p_organization_id,'discount_id',p_discount_id,'plan_key',p_plan_key,'period_months',p_period_months,'base_minor',p_base_minor);
 select * into previous from public.billing_discount_reservations where order_id=p_order_id;
 if found then
 if previous.request<>payload then raise exception 'discount order conflict' using errcode='22023'; end if;
 if previous.state='released' then raise exception 'discount reservation released' using errcode='55000'; end if;
 return previous.quote; end if;
 select * into code from public.billing_discount_codes where id=p_discount_id for update;
 if not found or code.organization_id<>p_organization_id or code.plan_key is distinct from p_plan_key
 or code.period_months is distinct from p_period_months then raise exception 'discount unavailable' using errcode='22023'; end if;
 -- Дедлайн действует для первой успешной покупки; продления использованной скидки
 -- не требуют повторной активации. Только reserved ещё не закрепляет скидку.
 if code.activate_before<=clock_timestamp() and not exists(select 1 from public.billing_discount_reservations
 where discount_id=code.id and state='consumed') then raise exception 'discount activation deadline expired' using errcode='22023'; end if;
 if exists(select 1 from public.billing_discount_reservations r join public.billing_discount_codes c on c.id=r.discount_id
 where r.organization_id=p_organization_id and r.discount_id<>code.id and
 (r.state='reserved' or (r.state='consumed' and
 (select count(*) from public.billing_discount_reservations x where x.discount_id=c.id and x.state='consumed')<c.eligible_periods))) then
 raise exception 'another discount active' using errcode='55000'; end if;
 select count(*) into used from public.billing_discount_reservations where discount_id=code.id and state in ('reserved','consumed');
 if used>=code.eligible_periods then raise exception 'discount periods exhausted' using errcode='55000'; end if;
 amount:=platform_private.calculate_discount_amount(p_base_minor,code.discount_bps)
 ||jsonb_build_object('discount_id',code.id,'period_months',code.period_months);
 insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote)
 values(p_order_id,code.id,p_organization_id,payload,amount);
 return amount;
end; $$;
revoke all on function platform_private.reserve_discount_period(uuid,uuid,uuid,text,integer,bigint) from public,anon,authenticated,service_role;

create function platform_private.settle_discount_period(p_order_id uuid,p_success boolean)
returns text language plpgsql security definer set search_path='' as $$
declare item public.billing_discount_reservations%rowtype; target text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_order_id is null or p_success is null then raise exception 'invalid discount settlement' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,8201));
 select * into item from public.billing_discount_reservations where order_id=p_order_id;
 if not found then raise exception 'discount reservation missing' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(item.organization_id::text,8202));
 target:=case when p_success then 'consumed' else 'released' end;
 if item.state=target then return target; end if;
 if item.state<>'reserved' then raise exception 'discount settlement conflict' using errcode='55000'; end if;
 update public.billing_discount_reservations set state=target,settled_at=clock_timestamp() where order_id=p_order_id;
 return target;
end; $$;
revoke all on function platform_private.settle_discount_period(uuid,boolean) from public,anon,authenticated,service_role;
commit;
