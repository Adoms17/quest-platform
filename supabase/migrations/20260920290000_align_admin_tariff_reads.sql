begin;
alter function public.read_platform_tariff_catalog(uuid,uuid) rename to read_platform_tariff_catalog_before_timeline;
revoke all on function public.read_platform_tariff_catalog_before_timeline(uuid,uuid) from public,anon,authenticated,service_role;
create function public.read_platform_tariff_catalog(p_after uuid default null,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
 result:=public.read_platform_tariff_catalog_before_timeline(p_after,p_id);
 select coalesce(jsonb_agg(value||jsonb_build_object('timeline_number',platform_private.tariff_timeline_number((value->>'id')::uuid),
 'timeline_state',platform_private.tariff_version_state((value->>'id')::uuid,statement_timestamp())) order by ord),'[]'::jsonb)
 into items from jsonb_array_elements(result->'items') with ordinality x(value,ord);
 return jsonb_set(result,'{items}',items);
end; $$;
revoke all on function public.read_platform_tariff_catalog(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_platform_tariff_catalog(uuid,uuid) to authenticated;
alter function public.read_platform_tariff_drafts(uuid,uuid) rename to read_platform_tariff_drafts_before_timeline;
revoke all on function public.read_platform_tariff_drafts_before_timeline(uuid,uuid) from public,anon,authenticated,service_role;
create function public.read_platform_tariff_drafts(p_source_version_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
 result:=public.read_platform_tariff_drafts_before_timeline(p_source_version_id,p_after);
 select coalesce(jsonb_agg((value-'latest_fixed')||jsonb_build_object('latest_publication',(
 select jsonb_build_object('id',t.version_id,'number',platform_private.tariff_timeline_number(t.version_id),
 'state',platform_private.tariff_version_state(t.version_id,statement_timestamp()),'effective_at',t.effective_at,'draft_revision',v.draft_revision)
 from public.platform_fixed_tariff_versions v join public.billing_tariff_timeline t on t.fixed_version_id=v.id
 where v.draft_id=(value->>'id')::uuid order by t.created_at desc,t.version_id desc limit 1),
 'is_published',exists(select 1 from public.platform_fixed_tariff_versions v join public.billing_tariff_timeline t on t.fixed_version_id=v.id
 where v.draft_id=(value->>'id')::uuid and t.revoked_at is null)) order by ord),'[]'::jsonb)
 into items from jsonb_array_elements(result->'items') with ordinality x(value,ord);
 return jsonb_set(result,'{items}',items);
end; $$;
revoke all on function public.read_platform_tariff_drafts(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_platform_tariff_drafts(uuid,uuid) to authenticated;
commit;
