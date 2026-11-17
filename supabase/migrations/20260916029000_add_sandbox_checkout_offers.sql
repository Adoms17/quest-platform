-- Закрытый каталог персональных sandbox-предложений. Production-цен нет.
begin;
create table public.billing_sandbox_offers (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 plan_version_id uuid not null references public.billing_plan_versions(id),
 expected_revision bigint not null check(expected_revision>=0),
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 shop_id text not null check(shop_id ~ '^[0-9]+$'),
 return_url text not null check(return_url ~ '^https://[^/@:?#]+(/[^[:space:]]*)?$'),
 period_start timestamptz not null check(isfinite(period_start)),
 period_end timestamptz not null check(isfinite(period_end) and period_end>period_start),
 valid_until timestamptz not null check(isfinite(valid_until)),
 created_at timestamptz not null default clock_timestamp()
);
create index sandbox_offers_org on public.billing_sandbox_offers(organization_id,valid_until);
alter table public.billing_sandbox_offers enable row level security;
revoke all on public.billing_sandbox_offers from public,anon,authenticated,service_role;
create function public.protect_sandbox_offer() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'sandbox offer immutable' using errcode='55000'; end;$$;
revoke all on function public.protect_sandbox_offer() from public,anon,authenticated;
create trigger sandbox_offer_immutable before update on public.billing_sandbox_offers for each row execute function public.protect_sandbox_offer();
alter table public.billing_sandbox_orders add column offer_id uuid references public.billing_sandbox_offers(id);

create function public.list_sandbox_checkout_offers(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
  select q.id as offer_id,q.organization_id,q.plan_version_id,p.display_name as plan_name,
   q.amount_minor,'RUB'::text as currency,q.period_start,q.period_end,q.valid_until,'sandbox'::text as environment
  from public.billing_sandbox_offers q join public.billing_plan_versions p on p.id=q.plan_version_id
  join public.organization_subscriptions s on s.organization_id=q.organization_id
  where q.organization_id=p_organization_id and q.valid_until>clock_timestamp() and q.period_end>clock_timestamp()
   and q.expected_revision=s.revision and s.status<>'transition' and p.plan_key<>'free'
  order by q.created_at desc,q.id limit 20
 ) t;
 return result;
end;$$;
revoke all on function public.list_sandbox_checkout_offers(uuid) from public,anon;
grant execute on function public.list_sandbox_checkout_offers(uuid) to authenticated;

create function public.accept_sandbox_checkout_offer(p_organization_id uuid,p_offer_id uuid,p_command_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.billing_sandbox_offers%rowtype; o public.billing_sandbox_orders%rowtype; result jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if p_command_id is null then raise exception 'invalid sandbox command' using errcode='22023'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'sandbox requires read committed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':sandbox:'||p_command_id::text,0));
 select * into o from public.billing_sandbox_orders where actor_id=auth.uid() and command_id=p_command_id;
 if found then
  if o.organization_id<>p_organization_id or o.offer_id is distinct from p_offer_id then raise exception 'sandbox command conflict' using errcode='22023'; end if;
  return o.id;
 end if;
 select * into q from public.billing_sandbox_offers where id=p_offer_id and organization_id=p_organization_id;
 if not found then raise exception 'sandbox offer unavailable' using errcode='42501'; end if;
 -- Блокировка до проверки срока: ожидание конкурентной операции не продлевает предложение.
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if q.valid_until<=clock_timestamp() or q.period_end<=clock_timestamp() then raise exception 'sandbox offer expired' using errcode='22023'; end if;
 result:=public.reserve_sandbox_payment_order(p_organization_id,p_command_id,q.expected_revision,q.plan_version_id,q.amount_minor,q.shop_id,q.return_url,q.period_start,q.period_end);
 -- reserve использует текущий контекст; связываем через отдельно разрешённый initial null переход ниже.
 update public.billing_sandbox_orders set offer_id=q.id where id=(result->>'id')::uuid;
 return (result->>'id')::uuid;
end;$$;
revoke all on function public.accept_sandbox_checkout_offer(uuid,uuid,uuid) from public,anon;
grant execute on function public.accept_sandbox_checkout_offer(uuid,uuid,uuid) to authenticated;

-- Единственное первичное связывание возможно только для ещё не отправленного заказа;
-- публичных UPDATE нет. Остальные неизменяемые поля продолжают защищаться.
create or replace function public.protect_sandbox_order_terms() returns trigger language plpgsql set search_path='' as $$
begin
 if old.first_sent_at is null and new.first_sent_at is not null and old.offer_id is not null
  and exists(select 1 from public.billing_sandbox_offers where id=old.offer_id and (valid_until<=clock_timestamp() or period_end<=clock_timestamp())) then
  raise exception 'sandbox offer expired' using errcode='22023'; end if;
 if (to_jsonb(new)-'state'-'first_sent_at'-'offer_id')<>(to_jsonb(old)-'state'-'first_sent_at'-'offer_id')
  or (old.first_sent_at is not null and new.first_sent_at is distinct from old.first_sent_at)
  or (new.offer_id is distinct from old.offer_id and (old.offer_id is not null or old.first_sent_at is not null or old.state<>'reserved')) then
  raise exception 'sandbox order terms immutable' using errcode='55000'; end if;
 return new;
end;$$;
create function public.cancel_unsent_sandbox_order(p_organization_id uuid,p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not found then raise exception 'sandbox order unavailable' using errcode='42501'; end if;
 if o.first_sent_at is not null then raise exception 'sandbox payment requires reconciliation' using errcode='22023'; end if;
 update public.billing_sandbox_orders set state='finished' where id=o.id;
end;$$;
revoke all on function public.cancel_unsent_sandbox_order(uuid,uuid) from public,anon;
grant execute on function public.cancel_unsent_sandbox_order(uuid,uuid) to authenticated;
commit;
