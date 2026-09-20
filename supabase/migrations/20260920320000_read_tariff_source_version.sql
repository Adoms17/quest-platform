begin;
create or replace function public.read_platform_tariff_catalog(p_after uuid default null,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
 result:=public.read_platform_tariff_catalog_before_timeline(p_after,p_id);
 select coalesce(jsonb_agg(value||jsonb_build_object('timeline_number',platform_private.tariff_timeline_number((value->>'id')::uuid),
 'timeline_state',platform_private.tariff_version_state((value->>'id')::uuid,statement_timestamp()),
 'effective_at',(select t.effective_at from public.billing_tariff_timeline t where t.version_id=(value->>'id')::uuid),
 'source_version',(select jsonb_build_object('id',b.id,'display_name',b.display_name,'timeline_number',platform_private.tariff_timeline_number(b.id))
 from public.platform_fixed_tariff_versions f join public.platform_tariff_drafts d on d.id=f.draft_id
 join public.billing_plan_versions b on b.id=d.source_version_id where f.id=(value->>'id')::uuid)) order by ord),'[]'::jsonb)
 into items from jsonb_array_elements(result->'items') with ordinality x(value,ord);
 return jsonb_set(result,'{items}',items);
end; $$;
revoke all on function public.read_platform_tariff_catalog(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_platform_tariff_catalog(uuid,uuid) to authenticated;
commit;
