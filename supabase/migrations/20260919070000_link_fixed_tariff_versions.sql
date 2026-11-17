begin;
create or replace function public.read_platform_tariff_drafts(p_source_version_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_tariff_draft_access();
 with candidates as (select d.*, (select jsonb_build_object('id',v.id,'version',v.version,'draft_revision',v.draft_revision,
 'enabled',exists(select 1 from public.platform_tariff_activations a where a.version_id=v.id))
 from public.platform_fixed_tariff_versions v where v.draft_id=d.id order by v.draft_revision desc limit 1) as latest_fixed
 from public.platform_tariff_drafts d where source_version_id=p_source_version_id and (p_after is null or id>p_after) order by id limit 26),
 numbered as(select *,row_number() over(order by id) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by id) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by id))[25] else null end) into result from numbered;
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),
 'action','billing.draft.read','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.read_platform_tariff_drafts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_tariff_drafts(uuid,uuid) to authenticated;


create function public.list_fixed_tariff_versions(p_source_id uuid,p_draft_id uuid default null,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_tariff_draft_access();
 with candidates as (
 select v.id,v.plan_key,v.version,v.display_name,v.active_quests_limit,v.team_members_limit,v.trial_duration_days,v.created_at,v.draft_id,v.draft_revision,
 exists(select 1 from public.platform_tariff_activations a where a.version_id=v.id) enabled
 from public.platform_fixed_tariff_versions v join public.platform_tariff_drafts d on d.id=v.draft_id
 where d.source_version_id=p_source_id and (p_draft_id is null or v.draft_id=p_draft_id) and (p_after is null or v.id>p_after)
 order by v.id limit 26), numbered as(select *,row_number() over(order by id) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by id) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by id))[25] else null end) into result from numbered;
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.version.list','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.list_fixed_tariff_versions(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_fixed_tariff_versions(uuid,uuid,uuid) to authenticated;
commit;
