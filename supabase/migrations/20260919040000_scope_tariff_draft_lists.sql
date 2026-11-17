begin;
drop function public.read_platform_tariff_drafts(uuid);
create function public.read_platform_tariff_drafts(p_source_version_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_tariff_draft_access();
 with candidates as (select * from public.platform_tariff_drafts
 where source_version_id=p_source_version_id and (p_after is null or id>p_after) order by id limit 26),
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

commit;
