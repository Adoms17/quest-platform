-- Independent shop payment contract. This migration activates no transport.
begin;
alter table public.shop_offers drop constraint shop_offers_provider_check;
alter table public.shop_offers drop constraint shop_offers_environment_check;
alter table public.shop_offers add constraint shop_offer_provider_environment check (
 (provider='synthetic' and environment='synthetic') or
 (provider='yookassa' and environment in ('sandbox','production') and merchant ~ '^[0-9]+$'));

-- Provisioned by the database owner after commercial/fiscal approval. Runtime
-- principals cannot supply, approve or alter this contract. No fiscal defaults.
create table public.shop_payment_contracts (
 order_id uuid primary key references public.shop_orders(id),
 contract_version text not null check(contract_version='shop-payment-v1'),
 approved boolean not null default false,
 test_only boolean not null,
 provider text not null check(provider='yookassa'),
 environment text not null check(environment in ('sandbox','production')),
 merchant text not null check(merchant ~ '^[0-9]+$'),
 return_origin text not null check(return_origin ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
 capture boolean not null,
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 created_at timestamptz not null default now()
);
create table public.shop_payment_attempts (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.shop_payment_contracts(order_id),
 idempotency_key uuid not null unique default gen_random_uuid(),
 provider text not null, environment text not null, merchant text not null,
 body_text text not null, body_hash text not null, snapshot_hash text not null,
 first_sent_at timestamptz not null default clock_timestamp(),
 provider_payment_id text,
 confirmation_url text,
 outcome text not null check(outcome in ('sending','unknown','observed','confirmed')),
 lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(),
 unique(provider,environment,merchant,provider_payment_id)
);
alter table public.shop_payment_contracts enable row level security;
alter table public.shop_payment_attempts enable row level security;
revoke all on public.shop_payment_contracts,public.shop_payment_attempts from public,anon,authenticated,service_role;
create trigger shop_payment_contract_immutable before update or delete on public.shop_payment_contracts
 for each row execute function public.guard_shop_immutable_row();
create function platform_private.guard_shop_payment_attempt() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'payment attempt immutable' using errcode='23514'; end if;
 if (to_jsonb(new)-array['provider_payment_id','confirmation_url','outcome','lease_token','lease_until'])
  is distinct from (to_jsonb(old)-array['provider_payment_id','confirmation_url','outcome','lease_token','lease_until'])
  or (old.provider_payment_id is not null and new.provider_payment_id is distinct from old.provider_payment_id)
  or (old.confirmation_url is not null and new.confirmation_url is distinct from old.confirmation_url)
  or (old.outcome='confirmed' and new.outcome<>'confirmed') then
  raise exception 'payment attempt binding immutable' using errcode='23514';
 end if;
 return new;
end;$$;
create trigger shop_payment_attempt_guard before update or delete on public.shop_payment_attempts
 for each row execute function platform_private.guard_shop_payment_attempt();

create function platform_private.check_shop_payment_actor(p_org uuid,p_actor uuid) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null or exists (
  select 1 from unnest(array['billing.manage','quests.create','quests.update']) required(permission)
  where not exists(select 1 from public.organization_memberships m
   join public.membership_roles mr on mr.membership_id=m.id
   join public.role_permissions rp on rp.role_id=mr.role_id
   join public.permissions p on p.id=rp.permission_id
   where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and p.key=required.permission)
 ) then raise exception 'shop payment access denied' using errcode='42501'; end if;
end;$$;

create function public.read_shop_payment_context(p_order_id uuid,p_actor_id uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.shop_orders%rowtype; c public.shop_payment_contracts%rowtype;
 a public.shop_payment_attempts%rowtype; item jsonb; value_text text; snapshot_hash text; body jsonb;
begin
 select * into strict o from public.shop_orders where id=p_order_id;
 if p_actor_id is not null then perform platform_private.check_shop_payment_actor(o.organization_id,p_actor_id); end if;
 select * into strict c from public.shop_payment_contracts where order_id=o.id;
 value_text := ((o.snapshot->>'amount_minor')::bigint/100)::text||'.'||lpad(((o.snapshot->>'amount_minor')::bigint%100)::text,2,'0');
 item:=c.receipt->'items'->0;
 if not c.approved or not c.capture or c.provider is distinct from o.snapshot->>'provider'
  or c.environment is distinct from o.snapshot->>'environment' or c.merchant is distinct from o.snapshot->>'merchant'
  or c.receipt->'items' is null or jsonb_typeof(c.receipt->'items') is distinct from 'array'
  or jsonb_array_length(c.receipt->'items')<>1
  or jsonb_typeof(c.receipt->'customer') is distinct from 'object'
  or not (coalesce(c.receipt->'customer'->>'email','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or coalesce(c.receipt->'customer'->>'phone','') ~ '^\+[0-9]{10,15}$')
  or coalesce(length(btrim(item->>'description')),0) not between 1 and 128
  or item->>'quantity' is distinct from '1.000'
  or item->'amount' is distinct from jsonb_build_object('value',value_text,'currency',o.snapshot->>'currency')
  or jsonb_typeof(item->'vat_code') is distinct from 'number'
  or (item->>'vat_code') !~ '^[1-9]$|^1[0-2]$'
  or coalesce(item->>'payment_subject','') not in ('commodity','excise','job','service','gambling_bet','gambling_prize','lottery','lottery_prize','intellectual_activity','payment','agent_commission','composite','another','property_right','non_operating_gain','insurance_premium','sales_tax','resort_fee','marked','non_marked')
  or item->>'payment_mode' is distinct from 'full_payment'
 then raise exception 'shop payment contract unavailable' using errcode='23514'; end if;
 snapshot_hash:=encode(extensions.digest(o.snapshot::text,'sha256'),'hex');
 body:=jsonb_build_object('amount',jsonb_build_object('value',value_text,'currency',o.snapshot->>'currency'),
  'capture',true,'confirmation',jsonb_build_object('type','redirect','return_url',c.return_origin||'/organization/shop/orders/'||o.id::text),
  'description','Quest order '||o.id::text,'metadata',jsonb_build_object('order_id',o.id,'organization_id',o.organization_id,
   'version_id',o.version_id,'offer_id',o.offer_id,'contract_version',c.contract_version,'snapshot_hash',snapshot_hash,'environment',c.environment),
  'receipt',c.receipt);
 select * into a from public.shop_payment_attempts where order_id=o.id;
 return jsonb_build_object('order_id',o.id,'snapshot',o.snapshot,'snapshot_hash',snapshot_hash,'contract',to_jsonb(c),
  'request_body',body,'attempt',case when a.id is null then null else to_jsonb(a) end,'paid_state',o.paid_state);
end;$$;

create function public.begin_shop_payment_attempt(p_order_id uuid,p_actor_id uuid,p_body jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.shop_orders%rowtype; a public.shop_payment_attempts%rowtype; ctx jsonb; claim uuid:=gen_random_uuid(); reason text;
begin
 select * into strict o from public.shop_orders where id=p_order_id for update;
 perform platform_private.check_shop_payment_actor(o.organization_id,p_actor_id);
 ctx:=public.read_shop_payment_context(o.id,p_actor_id);
 if p_body is distinct from ctx->'request_body' then raise exception 'payment request drift' using errcode='23514'; end if;
 select * into a from public.shop_payment_attempts where order_id=o.id for update;
 if a.id is not null and (a.body_text is distinct from p_body::text or a.snapshot_hash is distinct from ctx->>'snapshot_hash') then
  raise exception 'payment request drift' using errcode='23514'; end if;
 if o.paid_state='succeeded' then reason:='paid';
 elsif a.provider_payment_id is not null then reason:='identified';
 elsif a.id is not null and clock_timestamp()>=a.first_sent_at+interval '23 hours' then reason:='reconcile_required';
 elsif a.lease_until>clock_timestamp() then reason:='busy'; end if;
 if reason is not null then return jsonb_build_object('can_send',false,'reason',reason,'attempt',case when a.id is null then null else to_jsonb(a) end); end if;
 if a.id is null then
  insert into public.shop_payment_attempts(order_id,provider,environment,merchant,body_text,body_hash,snapshot_hash,outcome,lease_token,lease_until)
  values(o.id,ctx->'contract'->>'provider',ctx->'contract'->>'environment',ctx->'contract'->>'merchant',p_body::text,
   encode(extensions.digest(p_body::text,'sha256'),'hex'),ctx->>'snapshot_hash','sending',claim,clock_timestamp()+interval '45 seconds') returning * into a;
 else
  update public.shop_payment_attempts set outcome='sending',lease_token=claim,lease_until=clock_timestamp()+interval '45 seconds' where id=a.id returning * into a;
 end if;
 return jsonb_build_object('can_send',true,'attempt',to_jsonb(a));
end;$$;

create function public.mark_shop_payment_unknown(p_attempt_id uuid,p_lease_token uuid)
 returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 update public.shop_payment_attempts set outcome='unknown',lease_token=null,lease_until=null
 where id=p_attempt_id and lease_token=p_lease_token and provider_payment_id is null and outcome<>'confirmed';
 get diagnostics changed=row_count; return changed=1;
end;$$;

-- This validates a server observation, not provider authenticity. Only the trusted
-- server transport may call the public wrappers after its HTTPS request completes.
create function platform_private.validate_shop_payment(p_attempt public.shop_payment_attempts,p_payment jsonb)
 returns void language plpgsql set search_path='' as $$
declare body jsonb:=p_attempt.body_text::jsonb; url text:=p_payment->'confirmation'->>'confirmation_url';
begin
 if jsonb_typeof(p_payment) is distinct from 'object'
  or coalesce(p_payment->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_payment->'recipient'->>'account_id' is distinct from p_attempt.merchant
  or p_payment->'test' is distinct from to_jsonb(p_attempt.environment='sandbox')
  or p_payment->'amount' is distinct from body->'amount'
  or p_payment->'metadata' is distinct from body->'metadata'
  or coalesce(p_payment->>'status','') not in ('pending','waiting_for_capture','succeeded','canceled')
  or jsonb_typeof(p_payment->'paid') is distinct from 'boolean'
  or (url is not null and (p_payment->'confirmation'->>'type' is distinct from 'redirect'
   or url !~ '^https://(yoomoney\.ru|yookassa\.ru)/[^[:space:]\\]*$'))
 then raise exception 'shop provider binding mismatch' using errcode='23514'; end if;
end;$$;

create function public.record_shop_checkout_payment(p_attempt_id uuid,p_lease_token uuid,p_payment jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.shop_payment_attempts%rowtype; url text:=p_payment->'confirmation'->>'confirmation_url';
begin
 select * into strict a from public.shop_payment_attempts where id=p_attempt_id for update;
 perform platform_private.validate_shop_payment(a,p_payment);
 if exists(select 1 from public.shop_payment_bindings b where b.provider=a.provider and b.environment=a.environment
  and b.merchant=a.merchant and b.payment_id=p_payment->>'id' and b.order_id<>a.order_id) then
  raise exception 'shop payment already bound' using errcode='23514'; end if;
 if a.provider_payment_id is not null then
  if a.provider_payment_id<>p_payment->>'id' or (a.confirmation_url is not null and url is not null and a.confirmation_url<>url) then
   raise exception 'shop payment identity conflict' using errcode='23514'; end if;
  return to_jsonb(a);
 end if;
 if a.lease_token is null or a.lease_token is distinct from p_lease_token then raise exception 'stale payment claim' using errcode='23514'; end if;
 update public.shop_payment_attempts set provider_payment_id=p_payment->>'id',confirmation_url=url,
  outcome='observed',lease_token=null,lease_until=null where id=a.id returning * into a;
 return to_jsonb(a);
end;$$;

create function public.record_shop_verified_payment(p_attempt_id uuid,p_payment jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.shop_payment_attempts%rowtype; o public.shop_orders%rowtype; fact uuid;
begin
 select * into strict a from public.shop_payment_attempts where id=p_attempt_id for update;
 perform platform_private.validate_shop_payment(a,p_payment);
 if a.provider_payment_id is null or a.provider_payment_id<>p_payment->>'id' then raise exception 'unbound shop payment' using errcode='23514'; end if;
 if exists(select 1 from public.shop_payment_bindings b where b.provider=a.provider and b.environment=a.environment
  and b.merchant=a.merchant and b.payment_id=a.provider_payment_id and b.order_id<>a.order_id) then
  raise exception 'shop payment already bound' using errcode='23514'; end if;
 select * into strict o from public.shop_orders where id=a.order_id;
 if encode(extensions.digest(o.snapshot::text,'sha256'),'hex')<>a.snapshot_hash then raise exception 'shop snapshot drift' using errcode='23514'; end if;
 if p_payment->>'status'='succeeded' and p_payment->'paid'='true'::jsonb then
  insert into public.shop_trusted_payment_facts(event_id,order_id,payment_id,snapshot,status,paid)
  values('shop-payment-v1:'||a.id::text,o.id,a.provider_payment_id,o.snapshot,'succeeded',true)
  on conflict(event_id) do nothing;
  select id into strict fact from public.shop_trusted_payment_facts where event_id='shop-payment-v1:'||a.id::text;
  update public.shop_payment_attempts set outcome='confirmed',lease_token=null,lease_until=null where id=a.id;
 else
  select id into fact from public.shop_trusted_payment_facts where event_id='shop-payment-v1:'||a.id::text;
 end if;
 return jsonb_build_object('fact_id',fact,'status',case when fact is not null then 'confirmed' else 'not_paid' end);
end;$$;

revoke all on function platform_private.guard_shop_payment_attempt(),platform_private.check_shop_payment_actor(uuid,uuid),
 platform_private.validate_shop_payment(public.shop_payment_attempts,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_shop_payment_context(uuid,uuid),public.begin_shop_payment_attempt(uuid,uuid,jsonb),
 public.mark_shop_payment_unknown(uuid,uuid),public.record_shop_checkout_payment(uuid,uuid,jsonb),public.record_shop_verified_payment(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.read_shop_payment_context(uuid,uuid),public.begin_shop_payment_attempt(uuid,uuid,jsonb),
 public.mark_shop_payment_unknown(uuid,uuid),public.record_shop_checkout_payment(uuid,uuid,jsonb),public.record_shop_verified_payment(uuid,jsonb) to service_role;
commit;
