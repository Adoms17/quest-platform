begin;
create function public.read_platform_tariff_timeline(p_source_id uuid,p_after jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare plan text; rows jsonb; measured timestamptz:=statement_timestamp(); cursor_at timestamptz; cursor_id uuid;
begin
 perform public.require_platform_tariff_draft_access();
 select plan_key into plan from public.billing_plan_versions where id=p_source_id;
 if plan is null then raise exception 'tariff unavailable' using errcode='22023'; end if;
 if p_after is not null then
 cursor_at:=(p_after->>'effective_at')::timestamptz;cursor_id:=(p_after->>'id')::uuid;
 if cursor_at is null or cursor_id is null or not isfinite(cursor_at) then raise exception 'invalid cursor' using errcode='22023'; end if;
 end if;
 select coalesce(jsonb_agg(item order by effective_at,version_id),'[]'::jsonb) into rows from (
 select t.effective_at,t.version_id,jsonb_build_object('id',t.version_id,'number',platform_private.tariff_timeline_number(t.version_id),
 'effective_at',t.effective_at,'support_ends_at',t.support_ends_at,'revoked_at',t.revoked_at,
 'state',platform_private.tariff_version_state(t.version_id,measured),'can_revoke',t.revoked_at is null and t.effective_at>measured,
 'display_name',p.display_name,'active_quests_limit',p.active_quests_limit,'team_members_limit',p.team_members_limit,
 'trial_duration_days',p.trial_duration_days,'draft_id',v.draft_id,'draft_revision',v.draft_revision) item
 from public.billing_tariff_timeline t join public.billing_plan_versions p on p.id=t.version_id
 left join public.platform_fixed_tariff_versions v on v.id=t.fixed_version_id
 where t.plan_key=plan and (p_after is null or (t.effective_at,t.version_id)>(cursor_at,cursor_id))
 order by t.effective_at,t.version_id limit 26) page;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
 'next_cursor',case when jsonb_array_length(rows)>25 then jsonb_build_object('effective_at',rows->24->'effective_at','id',rows->24->'id') else null end,'measured_at',measured);
end; $$;
revoke all on function public.read_platform_tariff_timeline(uuid,jsonb) from public,anon,service_role;
grant execute on function public.read_platform_tariff_timeline(uuid,jsonb) to authenticated;
commit;
