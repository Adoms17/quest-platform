begin;
alter table public.platform_tariff_drafts add column description text not null default '' check(length(description)<=500);
drop function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer);
create function public.save_platform_tariff_draft(p_command_id uuid,p_id uuid,p_source_version_id uuid,
 p_expected_revision integer,p_display_name text,p_active_quests_limit integer,p_team_members_limit integer,p_trial_duration_days integer,p_description text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; receipt public.platform_tariff_draft_commands%rowtype;
 draft public.platform_tariff_drafts%rowtype; result jsonb;
begin
 -- Та же блокировка, что у изменения назначений: отзыв не обгоняет команду.
 perform pg_catalog.pg_advisory_xact_lock(18092026,1);
 perform public.require_platform_tariff_draft_access();
 if p_command_id is null or p_id is null or p_source_version_id is null
 or p_expected_revision is null or p_expected_revision<0
 or p_display_name is null or length(btrim(p_display_name)) not between 1 and 80
 or p_active_quests_limit is null or p_active_quests_limit<0
 or p_team_members_limit is null or p_team_members_limit<1
 or p_trial_duration_days is null or p_trial_duration_days<1 or length(p_description)>500 then
 raise exception 'invalid tariff draft' using errcode='22023'; end if;
 payload:=jsonb_build_object('id',p_id,'source',p_source_version_id,'revision',p_expected_revision,
 'name',p_display_name,'quests',p_active_quests_limit,'team',p_team_members_limit,'trial',p_trial_duration_days);
 if p_description is not null then payload:=payload||jsonb_build_object('description',p_description); end if;
 select * into receipt from public.platform_tariff_draft_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then
 raise exception 'command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 select * into draft from public.platform_tariff_drafts where id=p_id for update;
 if found then
 if draft.revision<>p_expected_revision or draft.source_version_id<>p_source_version_id then
 raise exception 'draft revision conflict' using errcode='40001'; end if;
 update public.platform_tariff_drafts set display_name=btrim(p_display_name),active_quests_limit=p_active_quests_limit,
 team_members_limit=p_team_members_limit,trial_duration_days=p_trial_duration_days,
 description=coalesce(p_description,description),revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into draft;
 else
 if p_expected_revision<>0 then raise exception 'draft revision conflict' using errcode='40001'; end if;
 if not exists(select 1 from public.billing_plan_versions where id=p_source_version_id) then
 raise exception 'unknown source version' using errcode='22023'; end if;
 insert into public.platform_tariff_drafts(id,source_version_id,display_name,active_quests_limit,team_members_limit,trial_duration_days,description)
 values(p_id,p_source_version_id,btrim(p_display_name),p_active_quests_limit,p_team_members_limit,p_trial_duration_days,coalesce(p_description,''))
 returning * into draft;
 end if;
 result:=to_jsonb(draft);
 insert into public.platform_tariff_draft_commands(command_id,actor_id,request,result)
 values(p_command_id,auth.uid(),payload,result);
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),
 'action','billing.draft.save','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer,text) to authenticated;
commit;
