begin;
-- Внутренняя подготовка. Клиентская выдача закрыта до интеграции всех путей старта.
create table public.offline_start_permits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quest_id uuid not null references public.quests(id) on delete restrict,
  participant_profile_id uuid not null references public.participant_profiles(id) on delete restrict,
  issued_at timestamptz not null default clock_timestamp(),
  policy_snapshot jsonb not null,
  state text not null default 'reserved' check(state in ('reserved','redeemed')),
  server_attempt_id uuid,
  check((state='reserved' and server_attempt_id is null) or (state='redeemed' and server_attempt_id is not null))
);
create unique index offline_start_permit_one_reserved on public.offline_start_permits(quest_id,participant_profile_id) where state='reserved';
create table public.offline_start_permit_requests (
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  command_id uuid not null,
  quest_id uuid not null,
  participant_profile_id uuid not null,
  permit_id uuid not null references public.offline_start_permits(id) on delete restrict,
  primary key(actor_user_id,command_id)
);
alter table public.offline_start_permits enable row level security;
alter table public.offline_start_permit_requests enable row level security;
revoke all on public.offline_start_permits,public.offline_start_permit_requests from public,anon,authenticated;

create function public.prepare_offline_start_permit(p_quest_id uuid,p_participant_profile_id uuid,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.quests%rowtype; s public.organization_subscriptions%rowtype;
  permit public.offline_start_permits%rowtype; request public.offline_start_permit_requests%rowtype;
  lifecycle jsonb; measured timestamptz; completed bigint;
begin
  if actor is null or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
    raise exception 'quest access denied' using errcode='42501'; end if;
  if p_command_id is null then raise exception 'invalid offline permit command' using errcode='22023'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'offline permit requires read committed' using errcode='40001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':permit:'||p_command_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_participant_profile_id::text||':'||p_quest_id::text,0));
  select * into q from public.quests where id=p_quest_id for share;
  if not found or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
    raise exception 'quest access denied' using errcode='42501'; end if;
  select * into request from public.offline_start_permit_requests where actor_user_id=actor and command_id=p_command_id;
  if found then
    if request.quest_id<>p_quest_id or request.participant_profile_id<>p_participant_profile_id then
      raise exception 'offline permit command conflict' using errcode='22023'; end if;
    select * into permit from public.offline_start_permits where id=request.permit_id;
  else
    select * into permit from public.offline_start_permits where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and state='reserved';
    if not found then
      select * into s from public.organization_subscriptions where organization_id=q.organization_id for update;
      measured:=clock_timestamp();
      lifecycle:=public.resolve_subscription_quota_phase(s,measured);
      if lifecycle->>'phase' not in ('free','active','trial','grace','transition') then
        raise exception 'offline permit billing unavailable' using errcode='P0001'; end if;
      if not coalesce(q.is_open,true) or (q.start_at is not null and q.start_at>measured)
        or (q.end_at is not null and q.end_at<measured) then
        raise exception 'quest is not available' using errcode='23514'; end if;
      if exists(select 1 from public.quest_attempts where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and finished_at is null) then
        raise exception 'quest attempt already active' using errcode='23514'; end if;
      select count(*) into completed from public.quest_attempts where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and finished_at is not null;
      if q.max_quest_attempts>0 and completed>=q.max_quest_attempts then
        raise exception 'quest completion limit reached' using errcode='23514'; end if;
      insert into public.offline_start_permits(organization_id,quest_id,participant_profile_id,policy_snapshot)
      values(q.organization_id,p_quest_id,p_participant_profile_id,lifecycle||jsonb_build_object('subscription_revision',s.revision,'contract_version',1)) returning * into permit;
    end if;
    insert into public.offline_start_permit_requests(actor_user_id,command_id,quest_id,participant_profile_id,permit_id)
      values(actor,p_command_id,p_quest_id,p_participant_profile_id,permit.id);
  end if;
  if permit.organization_id is distinct from q.organization_id then
    raise exception 'offline permit scope mismatch' using errcode='42501'; end if;
  return jsonb_build_object('id',permit.id,'quest_id',permit.quest_id,'participant_profile_id',permit.participant_profile_id,
    'issued_at',permit.issued_at,'state',permit.state);
end;
$$;
revoke all on function public.prepare_offline_start_permit(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_offline_start_permit(uuid,uuid,uuid) to service_role;
comment on function public.prepare_offline_start_permit(uuid,uuid,uuid) is
 'Внутренний примитив, требуется auth.uid инициатора. Не подключён к клиенту: online-старты ещё не погашают резерв, совместимость старых пакетов не готова. Не создаёт попытку, таймер или потребление участника.';
commit;
