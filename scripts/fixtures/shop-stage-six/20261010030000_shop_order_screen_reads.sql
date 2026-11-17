-- SHOP03.5 read models only. No payment producer, checkout URL or worker changes.
begin;
create function public.read_shop_offer(p_organization_id uuid,p_offer_id uuid)
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
  'sales_enabled',offer.sales_enabled and not product.withdrawn,'existing_order_id',order_id,'existing_acquisition_id',acquisition);
end;$$;
revoke all on function public.read_shop_offer(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_shop_offer(uuid,uuid) to authenticated;

create or replace function public.read_shop_order(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.shop_orders%rowtype;
begin
 select * into o from public.shop_orders where id=p_order_id;
 if not found or auth.uid() is null or not public.has_organization_permission(o.organization_id,'billing.manage') then
  raise exception 'shop order access denied' using errcode='42501'; end if;
 return jsonb_build_object('id',o.id,'snapshot',o.snapshot,'paid_state',o.paid_state,'fulfillment_state',o.fulfillment_state,
  'acquisition_id',o.acquisition_id,'quest_id',o.quest_id,'fulfillment_error',o.fulfillment_error,
  'copy_available',exists(select 1 from public.quests q where q.id=o.quest_id and q.organization_id=o.organization_id and q.shop_acquisition_id=o.acquisition_id));
end;$$;
revoke all on function public.read_shop_order(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_shop_order(uuid) to authenticated;

create function public.list_organization_shop_orders(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
  raise exception 'shop orders access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(public.read_shop_order(o.id) order by o.created_at desc,o.id)
  from public.shop_orders o where o.organization_id=p_organization_id and o.fulfillment_state<>'complete'),'[]'::jsonb);
end;$$;
revoke all on function public.list_organization_shop_orders(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_organization_shop_orders(uuid) to authenticated;
commit;
