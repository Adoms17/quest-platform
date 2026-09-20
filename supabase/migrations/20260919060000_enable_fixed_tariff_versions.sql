begin;
create table public.platform_tariff_activations (
 version_id uuid primary key references public.platform_fixed_tariff_versions(id),
 command_id uuid not null unique,
 actor_id uuid not null references auth.users(id),
 expected_previous_id uuid references public.billing_plan_versions(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_tariff_activations enable row level security;
revoke all on public.platform_tariff_activations from public,anon,authenticated,service_role;
create trigger platform_tariff_activations_immutable before update or delete or truncate on public.platform_tariff_activations
 for each statement execute function public.prevent_billing_plan_version_mutation();

create function public.preview_fixed_tariff_activation(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fixed public.platform_fixed_tariff_versions%rowtype; previous public.billing_plan_versions%rowtype;
begin
 perform public.require_platform_tariff_draft_access();
 select * into fixed from public.platform_fixed_tariff_versions where id=p_id;
 if not found then raise exception 'fixed version not found' using errcode='22023'; end if;
 select * into previous from public.billing_plan_versions where plan_key=fixed.plan_key order by version desc limit 1;
 return jsonb_build_object('version',to_jsonb(fixed),'previous',to_jsonb(previous),
 'enabled',exists(select 1 from public.platform_tariff_activations where version_id=p_id),
 'can_enable',fixed.version>coalesce(previous.version,0),
 'changes_trial_offer',fixed.plan_key<>'free','changes_free_fallback',false,
 'changes_existing_subscriptions',false,'enables_paid_sales',false);
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.version.preview_enable','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.preview_fixed_tariff_activation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_fixed_tariff_activation(uuid) to authenticated;

create function public.enable_fixed_tariff_version(p_command_id uuid,p_id uuid,p_expected_previous_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fixed public.platform_fixed_tariff_versions%rowtype; previous public.billing_plan_versions%rowtype;
 receipt public.platform_tariff_activations%rowtype;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_id is null then raise exception 'invalid activation request' using errcode='22023'; end if;
 select * into receipt from public.platform_tariff_activations where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.version_id<>p_id or receipt.expected_previous_id is distinct from p_expected_previous_id then
 raise exception 'command conflict' using errcode='22023'; end if;
 return to_jsonb(receipt); end if;
 select * into fixed from public.platform_fixed_tariff_versions where id=p_id;
 if not found then raise exception 'fixed version not found' using errcode='22023'; end if;
 lock table public.billing_plan_versions in share row exclusive mode;
 select * into previous from public.billing_plan_versions where plan_key=fixed.plan_key order by version desc limit 1;
 if previous.id is distinct from p_expected_previous_id then raise exception 'activation preview stale' using errcode='40001'; end if;
 if fixed.version<=coalesce(previous.version,0) or exists(select 1 from public.billing_plan_versions where id=p_id) then
 raise exception 'version cannot be enabled' using errcode='55000'; end if;
 insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,created_at)
 values(fixed.id,fixed.plan_key,fixed.version,fixed.display_name,fixed.active_quests_limit,fixed.team_members_limit,fixed.trial_duration_days,fixed.created_at);
 insert into public.platform_tariff_activations(version_id,command_id,actor_id,expected_previous_id)
 values(p_id,p_command_id,auth.uid(),p_expected_previous_id) returning * into receipt;
 return to_jsonb(receipt);
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.version.enable','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.enable_fixed_tariff_version(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.enable_fixed_tariff_version(uuid,uuid,uuid) to authenticated;

create function public.read_fixed_tariff_draft_version(p_draft_id uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_platform_tariff_draft_access();
 select to_jsonb(v) into result from public.platform_fixed_tariff_versions v where draft_id=p_draft_id and draft_revision=p_revision;
 return result;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.version.read_fixed','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.read_fixed_tariff_draft_version(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_fixed_tariff_draft_version(uuid,integer) to authenticated;
commit;
