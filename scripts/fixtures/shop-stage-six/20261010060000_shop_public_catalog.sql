-- Public editorial projection; private captured content is never a catalog source.
begin;
create table public.shop_catalog_publications (
 version_id uuid primary key references public.shop_quest_versions(id),
 offer_id uuid not null unique references public.shop_offers(id),
 payload jsonb not null,
 state text not null default 'published' check(state in ('published','withdrawn')),
 published_at timestamptz not null default now()
);
alter table public.shop_catalog_publications enable row level security;
revoke all on public.shop_catalog_publications from public,anon,authenticated,service_role;

-- Matches quest-public-export's card/compatibility/demo allowlist. Reject extra
-- keys and arbitrary nested values, including answers, URLs and trace metadata.
create function public.validate_shop_public_payload(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare section text; field text; claim jsonb; val jsonb; typ text; specs jsonb := '{"card":{"title":"text","description":"text","audience":"text","tags":"strings","includes":"strings"},"compatibility":{"age":"range","reading":"text","knowledge":"text","group":"range","homeVenue":"text","outdoorVenue":"text","playMinutes":"range","preparationMinutes":"range","devices":"text","connection":"text","gps":"text","printing":"printing","props":"text","adult":"text","weatherFallback":"text","connectionFallback":"text","adaptation":"text"},"demo":{"publicDemo":"demo"}}';
begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['card','compatibility','demo']<>'{}'::jsonb then return false; end if;
 for section in select jsonb_object_keys(specs) loop
  if jsonb_typeof(p->section) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p->section))<>(select count(*) from jsonb_object_keys(specs->section)) then return false; end if;
  for field,typ in select key,value from jsonb_each_text(specs->section) loop
   claim:=p->section->field;
   if jsonb_typeof(claim) is distinct from 'object' or claim-array['status','value']<>'{}'::jsonb
    or not(claim ? 'value') or claim->>'status' is null then return false; end if;
   val:=claim->'value';
   if claim->>'status'='unknown' then if val<>'null'::jsonb then return false; end if; continue; end if;
   if claim->>'status'<>'confirmed' then return false; end if;
   if typ='text' then
    if jsonb_typeof(val)<>'string' or length(btrim(val#>>'{}'))=0 then return false; end if;
   elsif typ='strings' then
    if jsonb_typeof(val)<>'array' then return false; end if;
    if exists(select 1 from jsonb_array_elements(val) x where jsonb_typeof(x)<>'string') then return false; end if;
   elsif typ='range' then
    if jsonb_typeof(val)<>'array' then return false; end if;
    if jsonb_array_length(val)<>2 or jsonb_typeof(val->0) is distinct from 'number' or jsonb_typeof(val->1) is distinct from 'number'
      or ((val->>0)~'^[0-9]{1,6}$' and (val->>1)~'^[0-9]{1,6}$') is distinct from true then return false; end if;
    if (val->>0)::int>(val->>1)::int then return false; end if;
   elsif typ='printing' then
    if jsonb_typeof(val)<>'object' or val-array['mode','details']<>'{}'::jsonb
      or coalesce(val->>'mode','') not in ('none','required') or jsonb_typeof(val->'details') is distinct from 'string' then return false; end if;
   elsif typ='demo' then
    if jsonb_typeof(val)<>'object' or val-array['question','label','hint','inputMode']<>'{}'::jsonb
      or coalesce(val->>'inputMode','') not in ('text','numeric') then return false; end if;
    if jsonb_typeof(val->'question') is distinct from 'string' or jsonb_typeof(val->'label') is distinct from 'string' or jsonb_typeof(val->'hint') is distinct from 'string' then return false; end if;
   end if;
  end loop;
 end loop;
 return p#>>'{card,title,status}'='confirmed' and p#>>'{card,description,status}'='confirmed';
end;$$;
revoke all on function public.validate_shop_public_payload(jsonb) from public,anon,authenticated,service_role;
alter table public.shop_catalog_publications add constraint shop_public_payload_valid check(public.validate_shop_public_payload(payload) and octet_length(payload::text)<=65536);
create function public.guard_shop_catalog_publication() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (tg_op='UPDATE' and (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state')) then
  raise exception 'public version immutable' using errcode='23514'; end if;
 if not exists(select 1 from public.shop_offers where id=new.offer_id and version_id=new.version_id) then
  raise exception 'catalog offer version mismatch' using errcode='23514'; end if;
 return new;
end;$$;
revoke all on function public.guard_shop_catalog_publication() from public,anon,authenticated,service_role;
create trigger guard_shop_catalog_publication before insert or update or delete on public.shop_catalog_publications for each row execute function public.guard_shop_catalog_publication();

-- Bounded list, exact version links, and content-free tombstones. No table grants.
create function public.read_shop_catalog(p_slug text default null,p_version_id uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset is null or p_offset<0 or p_offset>10000 or (p_version_id is not null and p_slug is null) then raise exception 'invalid catalog request' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(x.dto order by x.slug) from (
  select p.slug,jsonb_build_object('slug',p.slug,'product_id',p.id,'version_id',v.id,'version_label',v.version_label,
   'state',case when p.withdrawn or c.state='withdrawn' then 'withdrawn' else 'published' end,
   'payload',case when p.withdrawn or c.state='withdrawn' then null else c.payload end,
   'offer',case when p.withdrawn or c.state='withdrawn' then null else jsonb_build_object('id',o.id,'amount_minor',o.amount_minor,'currency',o.currency,'sales_enabled',o.sales_enabled) end) dto
  from public.shop_products p join lateral (
   select c.* from public.shop_catalog_publications c join public.shop_quest_versions v on v.id=c.version_id
   where v.product_id=p.id and (p_version_id is null or v.id=p_version_id)
   order by c.published_at desc,c.version_id desc limit 1
  ) c on true join public.shop_quest_versions v on v.id=c.version_id join public.shop_offers o on o.id=c.offer_id
  where (p_slug is null or p.slug=p_slug) and (p_slug is not null or (not p.withdrawn and c.state='published'))
  order by p.slug limit 100 offset p_offset
 ) x),'[]'::jsonb);
end;$$;
revoke all on function public.read_shop_catalog(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_shop_catalog(text,uuid,integer) to anon,authenticated;

-- Serialize order insertion with publication withdrawal. Existing orders and
-- fulfillment remain readable/recoverable; unpublished legacy offers unchanged.
create function public.guard_shop_catalog_order() returns trigger language plpgsql security definer set search_path='' as $$
declare status text;
begin
 select state into status from public.shop_catalog_publications where offer_id=new.offer_id for share;
 if found and status<>'published' then raise exception 'catalog withdrawn' using errcode='23514'; end if;
 return new;
end;$$;
revoke all on function public.guard_shop_catalog_order() from public,anon,authenticated,service_role;
create trigger guard_shop_catalog_order before insert on public.shop_orders for each row execute function public.guard_shop_catalog_order();
create or replace function public.read_shop_offer(p_organization_id uuid,p_offer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare offer public.shop_offers%rowtype; version public.shop_quest_versions%rowtype;
 product public.shop_products%rowtype; org_name text; order_id uuid; acquisition uuid;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
  raise exception 'shop offer access denied' using errcode='42501'; end if;
 select * into strict offer from public.shop_offers where id=p_offer_id;
 select * into strict version from public.shop_quest_versions where id=offer.version_id;
 select * into strict product from public.shop_products where id=version.product_id;
 select name into strict org_name from public.organizations where id=p_organization_id;
 select id into order_id from public.shop_orders where organization_id=p_organization_id and product_id=product.id;
 select a.id into acquisition from public.shop_acquisitions a join public.shop_quest_versions v on v.id=a.version_id
  where a.organization_id=p_organization_id and v.product_id=product.id order by a.acquired_at,a.id limit 1;
 return jsonb_build_object('snapshot',jsonb_build_object(
  'organization_id',p_organization_id,'organization_name',org_name,'product_id',product.id,'product_title',product.title,
  'version_id',version.id,'version_label',version.version_label,'offer_id',offer.id,'price_version',offer.price_version,
  'amount_minor',offer.amount_minor,'currency',offer.currency,'terms_id',offer.terms_id,'terms',offer.terms_snapshot),
  'sales_enabled',offer.sales_enabled and not product.withdrawn and not exists(select 1 from public.shop_catalog_publications c where c.offer_id=offer.id and c.state='withdrawn'),'existing_order_id',order_id,'existing_acquisition_id',acquisition);
end;$$;
revoke all on function public.read_shop_offer(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_shop_offer(uuid,uuid) to authenticated;


commit;
