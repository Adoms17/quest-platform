begin;
-- Повторная публикация после отзыва создаёт новый снимок даже той же правки.
alter table public.platform_fixed_tariff_versions drop constraint platform_fixed_tariff_versions_draft_id_draft_revision_key;
create table public.platform_tariff_publication_commands (
 command_id uuid primary key, actor_id uuid not null references auth.users(id),
 request jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_tariff_publication_commands enable row level security;
revoke all on public.platform_tariff_publication_commands from public,anon,authenticated,service_role;
create trigger tariff_publication_receipt_immutable before update or delete or truncate on public.platform_tariff_publication_commands
 for each statement execute function public.prevent_billing_plan_version_mutation();

create function platform_private.guard_published_tariff_draft() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(18092026,1);
 if exists(select 1 from public.platform_fixed_tariff_versions v join public.billing_tariff_timeline t on t.version_id=v.id
 where v.draft_id=old.id and t.revoked_at is null) then
 raise exception 'published draft is read only' using errcode='55000'; end if;
 return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function platform_private.guard_published_tariff_draft() from public,anon,authenticated,service_role;
create trigger published_tariff_draft_guard before update or delete on public.platform_tariff_drafts
 for each row execute function platform_private.guard_published_tariff_draft();

create function public.publish_tariff_draft(p_command_id uuid,p_draft_id uuid,p_expected_revision integer,p_effective_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare draft public.platform_tariff_drafts%rowtype; source public.billing_plan_versions%rowtype;
 receipt public.platform_tariff_publication_commands%rowtype; payload jsonb; output jsonb; snapshot_id uuid; internal_version integer;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_draft_id is null or p_expected_revision is null or p_effective_at is null or not isfinite(p_effective_at) then
 raise exception 'invalid publication request' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','publish','draft',p_draft_id,'revision',p_expected_revision,'effective_at',p_effective_at);
 select * into receipt from public.platform_tariff_publication_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then raise exception 'command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 select * into draft from public.platform_tariff_drafts where id=p_draft_id for update;
 if not found or draft.revision<>p_expected_revision then raise exception 'draft revision conflict' using errcode='40001'; end if;
 if p_effective_at<=clock_timestamp() then raise exception 'publication must be in future' using errcode='22023'; end if;
 if exists(select 1 from public.platform_fixed_tariff_versions v join public.billing_tariff_timeline t on t.version_id=v.id
 where v.draft_id=p_draft_id and t.revoked_at is null) then raise exception 'draft already published' using errcode='55000'; end if;
 select * into source from public.billing_plan_versions where id=draft.source_version_id;
 lock table public.billing_plan_versions in share row exclusive mode;
 -- Ожидание блокировки могло пересечь выбранное время старта.
 if p_effective_at<=clock_timestamp() then raise exception 'publication must be in future' using errcode='22023'; end if;
 select coalesce(max(n),0)+1 into internal_version from (
 select version n from public.billing_plan_versions where plan_key=source.plan_key
 union all select version from public.platform_fixed_tariff_versions where plan_key=source.plan_key) versions;
 insert into public.platform_fixed_tariff_versions(draft_id,draft_revision,plan_key,version,display_name,active_quests_limit,team_members_limit,trial_duration_days,actor_id,command_id)
 values(draft.id,draft.revision,source.plan_key,internal_version,draft.display_name,draft.active_quests_limit,draft.team_members_limit,draft.trial_duration_days,auth.uid(),p_command_id)
 returning id into snapshot_id;
 insert into public.billing_tariff_timeline(version_id,fixed_version_id,plan_key,effective_at)
 values(snapshot_id,snapshot_id,source.plan_key,p_effective_at);
 output:=jsonb_build_object('version_id',snapshot_id,'number_at_publication',platform_private.tariff_timeline_number(snapshot_id),'effective_at',p_effective_at);
 insert into public.platform_tariff_publication_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,output);
 return output;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.publish','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.publish_tariff_draft(uuid,uuid,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.publish_tariff_draft(uuid,uuid,integer,timestamptz) to authenticated;

create function public.revoke_tariff_publication(p_command_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare timeline public.billing_tariff_timeline%rowtype; receipt public.platform_tariff_publication_commands%rowtype;
 payload jsonb; output jsonb; measured timestamptz;
begin
 perform public.require_platform_owner();
 if p_command_id is null or p_version_id is null then raise exception 'invalid revocation request' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','revoke','version',p_version_id);
 select * into receipt from public.platform_tariff_publication_commands where command_id=p_command_id;
 if found then
 if receipt.actor_id<>auth.uid() or receipt.request<>payload then raise exception 'command conflict' using errcode='22023'; end if;
 return receipt.result; end if;
 select * into timeline from public.billing_tariff_timeline where version_id=p_version_id for update;
 measured:=clock_timestamp();
 if not found or timeline.revoked_at is not null or timeline.effective_at<=measured then
 raise exception 'publication cannot be revoked' using errcode='55000'; end if;
 update public.billing_tariff_timeline set revoked_at=measured where version_id=p_version_id;
 output:=jsonb_build_object('version_id',p_version_id,'revoked_at',measured);
 insert into public.platform_tariff_publication_commands(command_id,actor_id,request,result) values(p_command_id,auth.uid(),payload,output);
 return output;
exception when insufficient_privilege then
 raise log 'QVESTA_ADMIN_DENIAL %',jsonb_build_object('version',1,'event_id',gen_random_uuid(),'actor_id',auth.uid(),'action','billing.revoke_publication','sqlstate','42501','occurred_at',clock_timestamp()); raise;
end; $$;
revoke all on function public.revoke_tariff_publication(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.revoke_tariff_publication(uuid,uuid) to authenticated;
-- Старые изменяющие RPC больше не доступны клиенту.
revoke all on function public.fix_platform_tariff_version(uuid,uuid,integer) from authenticated;
revoke all on function public.enable_fixed_tariff_version(uuid,uuid,uuid) from authenticated;
commit;
