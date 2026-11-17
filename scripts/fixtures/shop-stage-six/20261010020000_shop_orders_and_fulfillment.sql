-- Bounded local SHOP order/fulfillment. No provider ingestion or financial sender.
begin;
create table public.shop_offers (
 id uuid primary key default gen_random_uuid(),
 version_id uuid not null references public.shop_quest_versions(id),
 price_version text not null check(length(btrim(price_version))>0),
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 terms_id text not null check(length(btrim(terms_id))>0),
 terms_snapshot jsonb not null check(jsonb_typeof(terms_snapshot)='object'),
 provider text not null check(provider='synthetic'),
 environment text not null check(environment='synthetic'),
 merchant text not null check(length(btrim(merchant))>0),
 sales_enabled boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.shop_orders (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.profiles(id) on delete restrict,
 operation_id uuid not null,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 product_id uuid not null references public.shop_products(id),
 version_id uuid not null references public.shop_quest_versions(id),
 offer_id uuid not null references public.shop_offers(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 paid_state text not null default 'unconfirmed' check(paid_state in ('unconfirmed','succeeded')),
 fulfillment_state text not null default 'pending' check(fulfillment_state in ('pending','entitled','copied','complete')),
 acquisition_id uuid references public.shop_acquisitions(id),
 quest_id uuid,
 fulfillment_error text check(fulfillment_error is null or fulfillment_error ~ '^[A-Z0-9]{5}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(actor_id,operation_id), unique(organization_id,product_id),
 check((fulfillment_state='pending' and acquisition_id is null and quest_id is null)
   or (paid_state='succeeded' and acquisition_id is not null and
     ((fulfillment_state='entitled' and quest_id is null) or (fulfillment_state in ('copied','complete') and quest_id is not null))))
);
-- No runtime principal can insert facts. The future verified producer is NOT
-- implemented. Only the disposable test database owner supplies synthetic facts.
create table public.shop_trusted_payment_facts (
 id uuid primary key default gen_random_uuid(),
 event_id text not null unique,
 order_id uuid not null references public.shop_orders(id),
 payment_id text not null check(length(btrim(payment_id))>0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 status text not null check(status in ('pending','unknown','canceled','succeeded')),
 paid boolean not null,
 created_at timestamptz not null default now()
);
create table public.shop_payment_bindings (
 order_id uuid primary key references public.shop_orders(id),
 provider text not null, environment text not null, merchant text not null, payment_id text not null,
 fact_id uuid not null references public.shop_trusted_payment_facts(id),
 unique(provider,environment,merchant,payment_id)
);
create table public.shop_fact_decisions (
 fact_id uuid primary key references public.shop_trusted_payment_facts(id),
 outcome text not null check(outcome in ('confirmed','duplicate','not_paid','mismatch','payment_conflict')),
 created_at timestamptz not null default now()
);
alter table public.shop_offers enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_trusted_payment_facts enable row level security;
alter table public.shop_payment_bindings enable row level security;
alter table public.shop_fact_decisions enable row level security;
revoke all on public.shop_offers,public.shop_orders,public.shop_trusted_payment_facts,public.shop_payment_bindings,public.shop_fact_decisions from public,anon,authenticated,service_role;

create function public.guard_shop_offer() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'sales_enabled') is distinct from (to_jsonb(old)-'sales_enabled') then
  raise exception 'shop offer snapshot immutable' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function public.guard_shop_offer() from public,anon,authenticated,service_role;
create trigger guard_shop_offer before update or delete on public.shop_offers for each row execute function public.guard_shop_offer();
create function public.guard_shop_order() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'shop order immutable' using errcode='23514'; end if;
 if (to_jsonb(new)-array['paid_state','fulfillment_state','acquisition_id','quest_id','updated_at','fulfillment_error'])
   is distinct from (to_jsonb(old)-array['paid_state','fulfillment_state','acquisition_id','quest_id','updated_at','fulfillment_error']) then
  raise exception 'shop order snapshot immutable' using errcode='23514';
 end if;
 if old.paid_state='succeeded' and new.paid_state<>'succeeded' then raise exception 'paid state cannot regress' using errcode='23514'; end if;
 if array_position(array['pending','entitled','copied','complete'],new.fulfillment_state)<array_position(array['pending','entitled','copied','complete'],old.fulfillment_state)
   or (old.acquisition_id is not null and new.acquisition_id is distinct from old.acquisition_id)
   or (old.quest_id is not null and new.quest_id is distinct from old.quest_id) then
  raise exception 'fulfillment cannot regress' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function public.guard_shop_order() from public,anon,authenticated,service_role;
create trigger guard_shop_order before update or delete on public.shop_orders for each row execute function public.guard_shop_order();
create trigger shop_fact_immutable before update or delete on public.shop_trusted_payment_facts for each row execute function public.guard_shop_immutable_row();
create trigger shop_binding_immutable before update or delete on public.shop_payment_bindings for each row execute function public.guard_shop_immutable_row();
create trigger shop_decision_immutable before update or delete on public.shop_fact_decisions for each row execute function public.guard_shop_immutable_row();

-- Serialize legacy SHOP04 acquisition insertion and order creation on the same
-- org/product key. Existing acquisitions (including legacy duplicates) are kept.
create function public.guard_shop_order_acquisition() returns trigger language plpgsql security definer set search_path='' as $$
declare product uuid; o public.shop_orders%rowtype;
begin
 select product_id into strict product from public.shop_quest_versions where id=new.version_id;
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||':shop-product:'||product::text,0));
 select * into o from public.shop_orders where organization_id=new.organization_id and product_id=product;
 if found and (o.paid_state<>'succeeded' or new.version_id<>o.version_id or new.fulfillment_reference<>'shop-order:'||o.id::text) then
  raise exception 'acquisition conflicts with shop order' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function public.guard_shop_order_acquisition() from public,anon,authenticated,service_role;
create trigger guard_shop_order_acquisition before insert on public.shop_acquisitions for each row execute function public.guard_shop_order_acquisition();

create function public.create_shop_order(p_organization_id uuid,p_offer_id uuid,p_operation_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare offer public.shop_offers%rowtype; version public.shop_quest_versions%rowtype; product public.shop_products%rowtype;
 prior public.shop_orders%rowtype; result uuid; org_name text;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage')
   or not public.has_organization_permission(p_organization_id,'quests.create') or not public.has_organization_permission(p_organization_id,'quests.update') then
  raise exception 'shop order access denied' using errcode='42501';
 end if;
 if p_operation_id is null then raise exception 'operation required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':shop-order:'||p_operation_id::text,0));
 select * into prior from public.shop_orders where actor_id=auth.uid() and operation_id=p_operation_id;
 if found then
  if prior.organization_id<>p_organization_id or prior.offer_id<>p_offer_id then raise exception 'shop command conflict' using errcode='22023'; end if;
  return prior.id;
 end if;
 select * into strict offer from public.shop_offers where id=p_offer_id for share;
 select * into strict version from public.shop_quest_versions where id=offer.version_id;
 select * into strict product from public.shop_products where id=version.product_id for share;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':shop-product:'||product.id::text,0));
 if not offer.sales_enabled or product.withdrawn then raise exception 'shop sales disabled' using errcode='23514'; end if;
 if exists(select 1 from public.shop_acquisitions a join public.shop_quest_versions v on v.id=a.version_id where a.organization_id=p_organization_id and v.product_id=product.id)
   or exists(select 1 from public.shop_orders where organization_id=p_organization_id and product_id=product.id) then
  raise exception 'product already acquired or ordered' using errcode='23514';
 end if;
 select name into strict org_name from public.organizations where id=p_organization_id;
 insert into public.shop_orders(actor_id,operation_id,organization_id,product_id,version_id,offer_id,snapshot)
 values(auth.uid(),p_operation_id,p_organization_id,product.id,version.id,offer.id,
   jsonb_build_object('organization_id',p_organization_id,'organization_name',org_name,'product_id',product.id,'product_title',product.title,
    'version_id',version.id,'version_label',version.version_label,'offer_id',offer.id,'price_version',offer.price_version,
    'amount_minor',offer.amount_minor,'currency',offer.currency,'terms_id',offer.terms_id,'terms',offer.terms_snapshot,
    'provider',offer.provider,'environment',offer.environment,'merchant',offer.merchant)) returning id into result;
 return result;
end;$$;
revoke all on function public.create_shop_order(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_shop_order(uuid,uuid,uuid) to authenticated;

create function public.read_shop_order(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.shop_orders%rowtype;
begin
 select * into o from public.shop_orders where id=p_order_id;
 if not found or auth.uid() is null or not public.has_organization_permission(o.organization_id,'billing.manage') then
  raise exception 'shop order access denied' using errcode='42501'; end if;
 return jsonb_build_object('id',o.id,'snapshot',o.snapshot,'paid_state',o.paid_state,'fulfillment_state',o.fulfillment_state,'acquisition_id',o.acquisition_id,'quest_id',o.quest_id,'fulfillment_error',o.fulfillment_error);
end;$$;
revoke all on function public.read_shop_order(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_shop_order(uuid) to authenticated;

create function public.process_shop_order_facts(p_limit integer default 20) returns integer
language plpgsql security definer set search_path='' as $$
declare f public.shop_trusted_payment_facts%rowtype; o public.shop_orders%rowtype; outcome text; count integer:=0; binding public.shop_payment_bindings%rowtype;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid batch size' using errcode='22023'; end if;
 -- A bounded nonblocking single writer prevents cross-order/payment lock cycles.
 -- Other workers return immediately and may still advance fulfillment in parallel.
 if not pg_try_advisory_xact_lock(hashtextextended('shop-facts-consumer-v1',0)) then return 0; end if;
 for f in select x.* from public.shop_trusted_payment_facts x where not exists(select 1 from public.shop_fact_decisions d where d.fact_id=x.id)
   order by x.created_at,x.id limit p_limit for update of x skip locked loop
  select * into strict o from public.shop_orders where id=f.order_id for update;
  if f.snapshot is distinct from o.snapshot then outcome:='mismatch';
  elsif f.status<>'succeeded' or not f.paid then outcome:='not_paid';
  else
   -- Payment binding is immutable and globally unique within the producer scope.
   insert into public.shop_payment_bindings(order_id,provider,environment,merchant,payment_id,fact_id)
    values(o.id,o.snapshot->>'provider',o.snapshot->>'environment',o.snapshot->>'merchant',f.payment_id,f.id) on conflict do nothing;
   select * into binding from public.shop_payment_bindings where order_id=o.id;
   if not found or row(binding.provider,binding.environment,binding.merchant,binding.payment_id)
     is distinct from row(o.snapshot->>'provider',o.snapshot->>'environment',o.snapshot->>'merchant',f.payment_id) then outcome:='payment_conflict';
   else
    outcome:=case when o.paid_state='succeeded' then 'duplicate' else 'confirmed' end;
    update public.shop_orders set paid_state='succeeded',updated_at=clock_timestamp() where id=o.id;
   end if;
  end if;
  insert into public.shop_fact_decisions(fact_id,outcome) values(f.id,outcome);
  count:=count+1;
 end loop;
 return count;
end;$$;
revoke all on function public.process_shop_order_facts(integer) from public,anon,authenticated,service_role;
grant execute on function public.process_shop_order_facts(integer) to service_role;

-- Private core is installed below; no JWT/claims mutation is used by the worker.

create function platform_private.issue_shop_acquisition_copy(p_organization_id uuid, p_acquisition_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare acquisition public.shop_acquisitions%rowtype; version public.shop_quest_versions%rowtype;
  draft public.quests%rowtype; task public.tasks%rowtype; item jsonb; prior uuid;
begin
  select * into acquisition from public.shop_acquisitions
    where id = p_acquisition_id and organization_id = p_organization_id for update;
  if not found then raise exception 'shop acquisition unavailable' using errcode = '42501'; end if;
  select quest_id into prior from public.shop_initial_copies where acquisition_id = acquisition.id;
  if found then
    if not exists(select 1 from public.quests where id = prior and organization_id = p_organization_id) then
      raise exception 'shop original copy was deleted' using errcode = 'P0001';
    end if;
    return prior;
  end if;
  select * into strict version from public.shop_quest_versions where id = acquisition.version_id;
  draft := jsonb_populate_record(null::public.quests, version.quest_snapshot);
  draft.id := gen_random_uuid(); draft.creator_id := p_actor_id; draft.organization_id := p_organization_id;
  draft.created_at := statement_timestamp(); draft.is_open := false; draft.is_public := false;
  draft.start_at := null; draft.end_at := null;
  draft.shop_acquisition_id := acquisition.id; draft.shop_version_id := version.id;
  draft.shop_owner_organization_id := p_organization_id; draft.shop_parent_quest_id := null;
  insert into public.quests select draft.*;
  for item in select value from jsonb_array_elements(version.task_snapshots) loop
    task := jsonb_populate_record(null::public.tasks, item);
    task.shop_source_task_id := task.id; task.id := gen_random_uuid(); task.quest_id := draft.id;
    task.shop_acquisition_id := acquisition.id;
    insert into public.tasks select task.*;
  end loop;
  insert into public.shop_initial_copies(acquisition_id, quest_id, actor_id) values(acquisition.id, draft.id, p_actor_id);
  return draft.id;
end;
$$;

revoke all on function platform_private.issue_shop_acquisition_copy(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.issue_shop_quest_copy(p_organization_id uuid,p_acquisition_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'quests.create')
   or not public.has_organization_permission(p_organization_id,'quests.update') then
  raise exception 'shop issuance access denied' using errcode='42501'; end if;
 return platform_private.issue_shop_acquisition_copy(p_organization_id,p_acquisition_id,auth.uid());
end;$$;
revoke all on function public.issue_shop_quest_copy(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_shop_quest_copy(uuid,uuid) to authenticated;

create function public.advance_shop_order_fulfillments(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.shop_orders%rowtype; acquired_entry public.shop_acquisitions%rowtype; q uuid; count integer:=0; failed integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid batch size' using errcode='22023'; end if;
 for o in select * from public.shop_orders where paid_state='succeeded' and fulfillment_state<>'complete'
   order by updated_at,id limit p_limit for update skip locked loop
  begin
  if o.fulfillment_state='pending' then
   insert into public.shop_acquisitions(organization_id,version_id,fulfillment_reference)
    values(o.organization_id,o.version_id,'shop-order:'||o.id::text) on conflict(fulfillment_reference) do nothing;
   select * into strict acquired_entry from public.shop_acquisitions where fulfillment_reference='shop-order:'||o.id::text;
   if acquired_entry.organization_id<>o.organization_id or acquired_entry.version_id<>o.version_id then raise exception 'shop acquisition binding conflict' using errcode='23514'; end if;
   update public.shop_orders set acquisition_id=acquired_entry.id,fulfillment_state='entitled',updated_at=clock_timestamp() where id=o.id;
  elsif o.fulfillment_state='entitled' then
   -- Receipt is the durable issuance fact even when the owner later deletes the
   -- working copy. Never issue another original in that case.
   select c.quest_id into q from public.shop_initial_copies c join public.shop_acquisitions a on a.id=c.acquisition_id
     where c.acquisition_id=o.acquisition_id and a.organization_id=o.organization_id and a.version_id=o.version_id;
   if not found then q:=platform_private.issue_shop_acquisition_copy(o.organization_id,o.acquisition_id,o.actor_id); end if;
   update public.shop_orders set quest_id=q,fulfillment_state='copied',updated_at=clock_timestamp() where id=o.id;
  else
   if not exists(select 1 from public.shop_initial_copies c join public.shop_acquisitions a on a.id=c.acquisition_id
     where c.acquisition_id=o.acquisition_id and c.quest_id=o.quest_id and a.organization_id=o.organization_id and a.version_id=o.version_id) then
    raise exception 'shop fulfillment receipt mismatch' using errcode='23514'; end if;
   update public.shop_orders set fulfillment_state='complete',updated_at=clock_timestamp() where id=o.id;
  end if;
  update public.shop_orders set fulfillment_error=null where id=o.id;
  count:=count+1;
  exception when others then
   -- This order's writes roll back, not the batch. Persist only a fixed SQLSTATE,
   -- move it behind other orders, and allow the next bounded worker to retry.
   update public.shop_orders set fulfillment_error=sqlstate,updated_at=clock_timestamp() where id=o.id;
   failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('advanced',count,'failed',failed);
end;$$;
revoke all on function public.advance_shop_order_fulfillments(integer) from public,anon,authenticated,service_role;
grant execute on function public.advance_shop_order_fulfillments(integer) to service_role;
commit;
