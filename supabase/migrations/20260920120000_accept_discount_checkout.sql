begin;
-- Подтверждённый расчёт, ещё не факт оплаты или выдачи доступа.
create table public.billing_discount_checkouts (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id), command_id uuid not null,
 offer_id uuid not null references public.billing_sandbox_offers(id),
 code_hash text not null, quote jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,command_id),
 foreign key(id) references public.billing_discount_reservations(order_id)
);
alter table public.billing_discount_checkouts enable row level security;
revoke all on public.billing_discount_checkouts from public,anon,authenticated,service_role;
create trigger discount_checkout_immutable before update or delete or truncate on public.billing_discount_checkouts
 for each statement execute function public.prevent_billing_plan_version_mutation();
-- Не публиковать RPC до реализации исполнения и отмены заказа.
create function platform_private.accept_discount_checkout(p_organization_id uuid,p_offer_id uuid,p_command_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.billing_discount_checkouts%rowtype; offer public.billing_sandbox_offers%rowtype;
 checked jsonb; amount jsonb; order_id uuid:=gen_random_uuid(); code_hash text; plan_key text;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_command_id is null or p_code is null or length(p_code)>128 then raise exception 'invalid discount checkout' using errcode='22023'; end if;
 code_hash:=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':discount-checkout:'||p_command_id::text,0));
 select * into old from public.billing_discount_checkouts where actor_id=auth.uid() and command_id=p_command_id;
 if found then
 if old.organization_id is distinct from p_organization_id or old.offer_id is distinct from p_offer_id or old.code_hash<>code_hash then
 raise exception 'discount checkout conflict' using errcode='22023'; end if;
 return old.quote; end if;
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 checked:=public.preview_sandbox_discount_offer(p_organization_id,p_offer_id,p_code);
 -- Не бросать исключение: сохранить счётчик неуспешных проверок кода.
 if not (checked->>'ok')::boolean then return checked; end if;
 if exists(select 1 from public.billing_discount_checkouts c join public.billing_discount_reservations r on r.order_id=c.id
 where c.organization_id=p_organization_id and r.state='reserved')
 or exists(select 1 from public.billing_sandbox_orders where organization_id=p_organization_id and state<>'finished') then
 return jsonb_build_object('ok',false,'reason','checkout_pending'); end if;
 select * into offer from public.billing_sandbox_offers where id=p_offer_id;
 select p.plan_key into plan_key from public.billing_plan_versions p where p.id=offer.plan_version_id;
 amount:=platform_private.reserve_discount_period(order_id,p_organization_id,(checked->>'discount_id')::uuid,plan_key,offer.period_months,offer.amount_minor);
 checked:=checked||amount||jsonb_build_object('order_id',order_id,'reserved',true,'status','awaiting_execution');
 insert into public.billing_discount_checkouts(id,organization_id,actor_id,command_id,offer_id,code_hash,quote)
 values(order_id,p_organization_id,auth.uid(),p_command_id,p_offer_id,code_hash,checked);
 return checked;
end; $$;
revoke all on function platform_private.accept_discount_checkout(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
commit;
