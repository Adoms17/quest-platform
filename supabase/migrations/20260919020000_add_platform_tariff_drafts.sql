begin;
-- Черновики не попадают в публичный каталог и не меняют подписки.
create table public.platform_tariff_drafts (
 id uuid primary key,
 source_version_id uuid not null references public.billing_plan_versions(id),
 display_name text not null check(length(btrim(display_name)) between 1 and 80),
 active_quests_limit integer not null check(active_quests_limit>=0),
 team_members_limit integer not null check(team_members_limit>=1),
 trial_duration_days integer not null check(trial_duration_days>0),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.platform_tariff_draft_commands (
 command_id uuid primary key,
 actor_id uuid not null references auth.users(id),
 request jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_tariff_drafts enable row level security;
alter table public.platform_tariff_draft_commands enable row level security;
revoke all on public.platform_tariff_drafts,public.platform_tariff_draft_commands from public,anon,authenticated,service_role;

create function public.require_platform_tariff_draft_access() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' or not exists(
 select 1 from public.platform_access_assignments a where a.user_id=auth.uid()
 and a.role_key in ('owner','sales') and a.scope_kind='platform'
 and a.revoked_at is null and a.valid_from<=statement_timestamp()
 and (a.expires_at is null or a.expires_at>statement_timestamp())) then
 raise exception 'platform access denied' using errcode='42501'; end if;
end; $$;
revoke all on function public.require_platform_tariff_draft_access() from public,anon,authenticated,service_role;

create function public.save_platform_tariff_draft(p_command_id uuid,p_id uuid,p_source_version_id uuid,
 p_expected_revision integer,p_display_name text,p_active_quests_limit integer,p_team_members_limit integer,p_trial_duration_days integer)
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
 or p_trial_duration_days is null or p_trial_duration_days<1 then
 raise exception 'invalid tariff draft' using errcode='22023'; end if;
 payload:=jsonb_build_object('id',p_id,'source',p_source_version_id,'revision',p_expected_revision,
 'name',p_display_name,'quests',p_active_quests_limit,'team',p_team_members_limit,'trial',p_trial_duration_days);
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
 revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into draft;
 else
 if p_expected_revision<>0 then raise exception 'draft revision conflict' using errcode='40001'; end if;
 if not exists(select 1 from public.billing_plan_versions where id=p_source_version_id) then
 raise exception 'unknown source version' using errcode='22023'; end if;
 insert into public.platform_tariff_drafts(id,source_version_id,display_name,active_quests_limit,team_members_limit,trial_duration_days)
 values(p_id,p_source_version_id,btrim(p_display_name),p_active_quests_limit,p_team_members_limit,p_trial_duration_days)
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
revoke all on function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_platform_tariff_draft(uuid,uuid,uuid,integer,text,integer,integer,integer) to authenticated;
create function public.read_platform_tariff_drafts(p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_tariff_draft_access();
 with candidates as (select * from public.platform_tariff_drafts
 where p_after is null or id>p_after order by id limit 26),
 numbered as(select *,row_number() over(order by id) n from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by id) filter(where n<=25),'[]'::jsonb),
 'next_cursor',case when count(*)>25 then (array_agg(id order by id))[25] else null end) into result from numbered;
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),
 'action','billing.draft.read','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.read_platform_tariff_drafts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_platform_tariff_drafts(uuid) to authenticated;
-- Предпросмотр читает сохранённую ревизию, а не значения, присланные UI.
create function public.preview_platform_tariff_draft(p_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare draft public.platform_tariff_drafts%rowtype; source public.billing_plan_versions%rowtype;
begin
 perform public.require_platform_tariff_draft_access();
 select * into draft from public.platform_tariff_drafts where id=p_id;
 if not found or p_expected_revision is null or draft.revision<>p_expected_revision then
 raise exception 'draft revision conflict' using errcode='40001'; end if;
 select * into source from public.billing_plan_versions where id=draft.source_version_id;
 return jsonb_build_object('draft',to_jsonb(draft),'source',to_jsonb(source),
 'changes',jsonb_build_object(
 'display_name',draft.display_name is distinct from source.display_name,
 'active_quests_limit',draft.active_quests_limit is distinct from source.active_quests_limit,
 'team_members_limit',draft.team_members_limit is distinct from source.team_members_limit,
 'trial_duration_days',source.plan_key<>'free' and draft.trial_duration_days is distinct from source.trial_duration_days),
 'affects_existing_subscriptions',false,'enables_new_connections',false);
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.draft.preview','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.preview_platform_tariff_draft(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_platform_tariff_draft(uuid,integer) to authenticated;
commit;
