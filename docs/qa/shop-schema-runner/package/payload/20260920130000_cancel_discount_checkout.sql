begin;
-- Отдельное состояние исполнения: неизменяемый расчёт заказа сохраняется.
create table public.billing_discount_checkout_states (
 order_id uuid primary key references public.billing_discount_checkouts(id),
 state text not null default 'ready' check(state in ('ready','executing','cancelled')),
 changed_at timestamptz not null default clock_timestamp()
);
alter table public.billing_discount_checkout_states enable row level security;
revoke all on public.billing_discount_checkout_states from public,anon,authenticated,service_role;
insert into public.billing_discount_checkout_states(order_id) select id from public.billing_discount_checkouts;
create function platform_private.initialize_discount_checkout_state() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.billing_discount_checkout_states(order_id) values(new.id); return new; end; $$;
revoke all on function platform_private.initialize_discount_checkout_state() from public,anon,authenticated,service_role;
create trigger discount_checkout_state after insert on public.billing_discount_checkouts for each row execute function platform_private.initialize_discount_checkout_state();

create function platform_private.cancel_discount_checkout(p_organization_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare state text;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if not exists(select 1 from public.billing_discount_checkouts where id=p_order_id and organization_id=p_organization_id) then raise exception 'discount checkout unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,8201));
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,8202));
 select s.state into state from public.billing_discount_checkout_states s where order_id=p_order_id for update;
 if state='cancelled' then return state; end if;
 if state is distinct from 'ready' then raise exception 'discount checkout requires reconciliation' using errcode='55000'; end if;
 perform platform_private.settle_discount_period(p_order_id,false);
 update public.billing_discount_checkout_states set state='cancelled',changed_at=clock_timestamp() where order_id=p_order_id;
 return 'cancelled';
end; $$;
revoke all on function platform_private.cancel_discount_checkout(uuid,uuid) from public,anon,authenticated,service_role;

-- Доверенный обработчик обязан зафиксировать начало до внешнего платежа.
-- Сам маркер не выполняет платёж и не выдаёт доступ.
create function platform_private.begin_discount_checkout_execution(p_order_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare org uuid; state text; reservation text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 select organization_id into org from public.billing_discount_checkouts where id=p_order_id;
 if org is null then raise exception 'discount checkout unavailable' using errcode='22023'; end if;
 perform 1 from public.organization_subscriptions where organization_id=org for update;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,8201));
 perform pg_advisory_xact_lock(hashtextextended(org::text,8202));
 select s.state into state from public.billing_discount_checkout_states s where order_id=p_order_id for update;
 select r.state into reservation from public.billing_discount_reservations r where order_id=p_order_id;
 if state='executing' then return state; end if;
 if state is distinct from 'ready' or reservation is distinct from 'reserved' then raise exception 'discount checkout not executable' using errcode='55000'; end if;
 update public.billing_discount_checkout_states set state='executing',changed_at=clock_timestamp() where order_id=p_order_id;
 return 'executing';
end; $$;
revoke all on function platform_private.begin_discount_checkout_execution(uuid) from public,anon,authenticated,service_role;

-- Retry возвращает сохранённые цены, но актуальное состояние отмены/исполнения.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('platform_private.accept_discount_checkout(uuid,uuid,uuid,text)'::regprocedure);
 if position('return old.quote; end if;' in definition)=0 then raise exception 'checkout retry patch mismatch'; end if;
 definition:=replace(definition,'return old.quote; end if;',
 'return old.quote || jsonb_build_object(''status'',case (select cs.state from public.billing_discount_checkout_states cs where cs.order_id=old.id) when ''cancelled'' then ''cancelled'' when ''executing'' then ''executing'' else ''awaiting_execution'' end,''reserved'',(select dr.state=''reserved'' from public.billing_discount_reservations dr where dr.order_id=old.id)); end if;');
 execute definition;
end; $$;
commit;
