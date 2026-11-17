-- 6D-01.2: закрытый серверный журнал тестовых заказов; не подтверждение оплаты.
begin;
create table public.billing_sandbox_orders (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 actor_id uuid not null, command_id uuid not null,
 plan_version_id uuid not null references public.billing_plan_versions(id),
 expected_revision bigint not null check(expected_revision>=0),
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 currency text not null check(currency='RUB'),
 shop_id text not null check(shop_id ~ '^[0-9]+$'),
 return_url text not null check(return_url ~ '^https://[^/@:?#]+(/[^[:space:]]*)?$'),
 period_start timestamptz not null check(isfinite(period_start)),
 period_end timestamptz not null check(isfinite(period_end) and period_end>period_start),
 idempotency_key uuid not null unique default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(), first_sent_at timestamptz,
 state text not null default 'reserved' check(state in ('reserved','sending','review','finished')),
 unique(actor_id,command_id),
 check(first_sent_at is null or isfinite(first_sent_at))
);
create unique index billing_sandbox_one_pending_org on public.billing_sandbox_orders(organization_id) where state<>'finished';
alter table public.billing_sandbox_orders enable row level security;
revoke all on public.billing_sandbox_orders from public,anon,authenticated,service_role;

create function public.protect_sandbox_order_terms() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'state'-'first_sent_at')<>(to_jsonb(old)-'state'-'first_sent_at')
    or (old.first_sent_at is not null and new.first_sent_at is distinct from old.first_sent_at) then
   raise exception 'sandbox order terms immutable' using errcode='55000'; end if;
 return new;
end;$$;
revoke all on function public.protect_sandbox_order_terms() from public,anon,authenticated;
create trigger sandbox_order_terms before update on public.billing_sandbox_orders for each row execute function public.protect_sandbox_order_terms();

create function public.reserve_sandbox_payment_order(p_organization_id uuid,p_command_id uuid,p_expected_revision bigint,
 p_plan_version_id uuid,p_amount_minor bigint,p_shop_id text,p_return_url text,p_period_start timestamptz,p_period_end timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.organization_subscriptions%rowtype; o public.billing_sandbox_orders%rowtype;
begin
 if actor is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
   raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'sandbox requires read committed' using errcode='40001'; end if;
 if p_command_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid sandbox command' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':sandbox:'||p_command_id::text,0));
 select * into s from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not found then raise exception 'billing state missing' using errcode='P0001'; end if;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where actor_id=actor and command_id=p_command_id;
 if found then
   if row(o.organization_id,o.expected_revision,o.plan_version_id,o.amount_minor,o.shop_id,o.return_url,o.period_start,o.period_end)
      is distinct from row(p_organization_id,p_expected_revision,p_plan_version_id,p_amount_minor,p_shop_id,p_return_url,p_period_start,p_period_end) then
     raise exception 'sandbox command conflict' using errcode='22023'; end if;
   return to_jsonb(o);
 end if;
 if s.revision<>p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
 if s.status='transition' then raise exception 'billing transition requires agreement' using errcode='P0001'; end if;
 if not exists(select 1 from public.billing_plan_versions where id=p_plan_version_id and plan_key<>'free') then
   raise exception 'invalid sandbox plan' using errcode='22023'; end if;
 if exists(select 1 from public.billing_sandbox_orders where organization_id=p_organization_id and state<>'finished') then
   raise exception 'sandbox order already pending' using errcode='P0001'; end if;
 insert into public.billing_sandbox_orders(organization_id,actor_id,command_id,expected_revision,plan_version_id,amount_minor,currency,shop_id,return_url,period_start,period_end)
 values(p_organization_id,actor,p_command_id,p_expected_revision,p_plan_version_id,p_amount_minor,'RUB',p_shop_id,p_return_url,p_period_start,p_period_end) returning * into o;
 return to_jsonb(o);
end;$$;
revoke all on function public.reserve_sandbox_payment_order(uuid,uuid,bigint,uuid,bigint,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_sandbox_payment_order(uuid,uuid,bigint,uuid,bigint,text,text,timestamptz,timestamptz) to service_role;

create function public.begin_sandbox_payment_send(p_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; s public.organization_subscriptions%rowtype; org uuid; measured timestamptz;
begin
 select organization_id into org from public.billing_sandbox_orders where id=p_order_id;
 if auth.uid() is null or org is null or not public.has_organization_permission(org,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'sandbox requires read committed' using errcode='40001'; end if;
 select * into s from public.organization_subscriptions where organization_id=org for update;
 select * into o from public.billing_sandbox_orders where id=p_order_id for update;
 if not public.has_organization_permission(org,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 measured:=clock_timestamp();
 if o.state in ('review','finished') then return jsonb_build_object('can_send',false,'reason','payment_reconciliation_required'); end if;
 if o.first_sent_at is null and s.revision<>o.expected_revision then
   raise exception 'billing revision conflict' using errcode='40001'; end if;
 if o.first_sent_at is not null and measured>=o.first_sent_at+interval '23 hours' then
   update public.billing_sandbox_orders set state='review' where id=o.id;
   return jsonb_build_object('can_send',false,'reason','payment_reconciliation_required');
 end if;
 update public.billing_sandbox_orders set first_sent_at=coalesce(first_sent_at,measured),state='sending' where id=o.id returning * into o;
 return jsonb_build_object('can_send',true,'order',jsonb_build_object('id',o.id,'organizationId',o.organization_id,'planVersionId',o.plan_version_id,
 'environment','sandbox','shopId',o.shop_id,'returnUrl',o.return_url,'amountMinor',o.amount_minor,'currency',o.currency,'idempotencyKey',o.idempotency_key,'firstSentAt',o.first_sent_at));
end;$$;
revoke all on function public.begin_sandbox_payment_send(uuid) from public,anon,authenticated;
grant execute on function public.begin_sandbox_payment_send(uuid) to service_role;
commit;
