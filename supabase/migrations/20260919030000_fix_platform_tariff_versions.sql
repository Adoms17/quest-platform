begin;
-- Закрытая фиксация: до включения ID отсутствует в billing_plan_versions.
create table public.platform_fixed_tariff_versions (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.platform_tariff_drafts(id),
 draft_revision integer not null,
 plan_key text not null,
 version integer not null check(version>0),
 display_name text not null,
 active_quests_limit integer not null check(active_quests_limit>=0),
 team_members_limit integer not null check(team_members_limit>=1),
 trial_duration_days integer not null check(trial_duration_days>0),
 actor_id uuid not null references auth.users(id),
 command_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp(),
 unique(draft_id,draft_revision), unique(plan_key,version)
);
alter table public.platform_fixed_tariff_versions enable row level security;
revoke all on public.platform_fixed_tariff_versions from public,anon,authenticated,service_role;
create trigger platform_fixed_tariffs_immutable before update or delete or truncate on public.platform_fixed_tariff_versions
 for each statement execute function public.prevent_billing_plan_version_mutation();

create function public.fix_platform_tariff_version(p_command_id uuid,p_draft_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare draft public.platform_tariff_drafts%rowtype; fixed public.platform_fixed_tariff_versions%rowtype;
 source public.billing_plan_versions%rowtype; next_version integer;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_draft_id is null or p_expected_revision is null or p_expected_revision<1 then
 raise exception 'invalid fixation request' using errcode='22023'; end if;
 select * into fixed from public.platform_fixed_tariff_versions where command_id=p_command_id;
 if found then
 if fixed.actor_id<>auth.uid() or fixed.draft_id<>p_draft_id or fixed.draft_revision<>p_expected_revision then
 raise exception 'command conflict' using errcode='22023'; end if;
 return to_jsonb(fixed); end if;
 select * into draft from public.platform_tariff_drafts where id=p_draft_id for update;
 if not found or draft.revision<>p_expected_revision then
 raise exception 'draft revision conflict' using errcode='40001'; end if;
 select * into fixed from public.platform_fixed_tariff_versions where draft_id=p_draft_id and draft_revision=p_expected_revision;
 if found then raise exception 'draft revision already fixed' using errcode='55000'; end if;
 select * into source from public.billing_plan_versions where id=draft.source_version_id;
 -- Согласовано с конкурентными вставками в действующий каталог.
 lock table public.billing_plan_versions in share row exclusive mode;
 select coalesce(max(v),0)+1 into next_version from (
 select version v from public.billing_plan_versions where plan_key=source.plan_key
 union all select version from public.platform_fixed_tariff_versions where plan_key=source.plan_key) versions;
 insert into public.platform_fixed_tariff_versions(draft_id,draft_revision,plan_key,version,display_name,
 active_quests_limit,team_members_limit,trial_duration_days,actor_id,command_id)
 values(draft.id,draft.revision,source.plan_key,next_version,draft.display_name,draft.active_quests_limit,
 draft.team_members_limit,draft.trial_duration_days,auth.uid(),p_command_id) returning * into fixed;
 return to_jsonb(fixed);
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),
 'action','billing.version.fix','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.fix_platform_tariff_version(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.fix_platform_tariff_version(uuid,uuid,integer) to authenticated;
commit;
