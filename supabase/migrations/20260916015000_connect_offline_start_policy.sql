begin;
alter table public.organization_subscriptions add column quest_start_enforcement_enabled boolean not null default false;
create or replace function public.start_quest_attempt_for_participant_core(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
returns table (
  id uuid, quest_id uuid, user_id uuid, participant_profile_id uuid,
  started_at timestamp with time zone, finished_at timestamp with time zone,
  total_tasks integer, completed_tasks integer, failed_tasks integer,
  total_attempts integer, total_time integer, percent_success double precision
)
language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  quest_record public.quests%rowtype;
  attempt_record public.quest_attempts%rowtype;
  task_count integer;
  permit public.offline_start_permits%rowtype;
  completed_attempt_count integer; subscription public.organization_subscriptions%rowtype; lifecycle jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_participant_profile_id::text||':'||p_quest_id::text,0));
  select * into quest_record from public.quests where quests.id=p_quest_id for share;
  if not found or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
    raise exception 'quest access denied' using errcode='42501'; end if;
  if not coalesce(quest_record.is_open,true)
    or (quest_record.start_at is not null and quest_record.start_at>clock_timestamp())
    or (quest_record.end_at is not null and quest_record.end_at<clock_timestamp()) then
    raise exception 'quest is not available' using errcode='23514'; end if;
  select op.* into permit from public.offline_start_permits op
    where op.quest_id=p_quest_id and op.participant_profile_id=p_participant_profile_id and op.state='reserved' for update;
  if found and permit.organization_id is distinct from quest_record.organization_id then
    raise exception 'offline permit scope mismatch' using errcode='42501'; end if;
  select * into attempt_record from public.quest_attempts attempt
  where attempt.quest_id = p_quest_id
    and attempt.participant_profile_id = p_participant_profile_id
    and attempt.finished_at is null
  for update;

  if found and attempt_record.user_id <> current_user_id then
    update public.quest_attempts
    set user_id = current_user_id
    where quest_attempts.id = attempt_record.id
    returning * into attempt_record;
  elsif not found then
    select * into subscription from public.organization_subscriptions where organization_id=quest_record.organization_id for update;
    if subscription.quest_start_enforcement_enabled and permit.id is null then
      if current_setting('transaction_isolation')<>'read committed' then
        raise exception 'offline permit requires read committed' using errcode='40001'; end if;
      lifecycle:=public.resolve_subscription_quota_phase(subscription,clock_timestamp());
      if lifecycle->>'phase' not in ('free','active','trial','grace','transition') then
        raise exception 'quest start billing unavailable' using errcode='P0001'; end if;
    end if;
    if quest_record.max_quest_attempts > 0 then
      select count(*)::integer into completed_attempt_count
      from public.quest_attempts attempt
      where attempt.quest_id = p_quest_id
        and attempt.participant_profile_id = p_participant_profile_id
        and attempt.finished_at is not null;
      if completed_attempt_count >= quest_record.max_quest_attempts then
        raise exception using errcode = '23514', message = 'quest completion limit reached';
      end if;
    end if;

    select count(*)::integer into task_count
    from public.tasks where tasks.quest_id = p_quest_id;
    insert into public.quest_attempts (
      quest_id, user_id, actor_user_id, participant_profile_id, total_tasks
    ) values (
      p_quest_id, current_user_id, current_user_id, p_participant_profile_id, task_count
    ) returning * into attempt_record;
  end if;

  if permit.id is not null then
    update public.offline_start_permits set state='redeemed',server_attempt_id=attempt_record.id where offline_start_permits.id=permit.id;
  end if;
  return query select attempt_record.id, attempt_record.quest_id, attempt_record.user_id,
    attempt_record.participant_profile_id, attempt_record.started_at, attempt_record.finished_at,
    attempt_record.total_tasks, attempt_record.completed_tasks, attempt_record.failed_tasks,
    attempt_record.total_attempts, attempt_record.total_time, attempt_record.percent_success;
end;
$$;
-- Клиент получает только выдачу и связанную регистрацию, не отдельное погашение.
grant execute on function public.prepare_offline_start_permit(uuid,uuid,uuid) to authenticated;
grant execute on function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) to authenticated;
comment on column public.organization_subscriptions.quest_start_enforcement_enabled is
 'Явное включение сервером после согласованного rollout. По умолчанию false для всех организаций. Существующая попытка и выданное право не отзываются.';
create or replace function public.register_offline_quest_attempt_core(p_quest_id uuid, p_participant_profile_id uuid, p_local_attempt_id text, p_existing_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  registration public.offline_attempt_registrations%rowtype;
  attempt public.quest_attempts%rowtype;
  resolved_id uuid;
begin
  if actor is null or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
    raise exception 'quest access denied' using errcode='42501';
  end if;
  if p_local_attempt_id is null or length(p_local_attempt_id) not between 1 and 200 then
    raise exception 'invalid local attempt id' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':offline:' || p_local_attempt_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_participant_profile_id::text||':'||p_quest_id::text,0));
  if exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id) then
    raise exception 'offline attempt requires review' using errcode='P0001'; end if;
  select * into registration from public.offline_attempt_registrations
    where actor_user_id=actor and local_attempt_id=p_local_attempt_id;
  if found then
    if registration.quest_id<>p_quest_id or registration.participant_profile_id<>p_participant_profile_id then
      raise exception 'offline attempt scope mismatch' using errcode='42501';
    end if;
    if p_existing_attempt_id is not null and p_existing_attempt_id <> registration.server_attempt_id then
      raise exception 'offline attempt scope mismatch' using errcode='42501';
    end if;
    if registration.permit_id is not null then
      raise exception 'offline permit registration required' using errcode='23505';
    end if;
    resolved_id := registration.server_attempt_id;
  else
    if p_existing_attempt_id is not null then
      -- ID клиента только подсказка: принадлежность проверяется ниже до commit.
      resolved_id := p_existing_attempt_id;
    else
      if exists(select 1 from public.offline_start_permits where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and state='reserved') then
        raise exception 'offline permit registration required' using errcode='23505';
      end if;
      select id into resolved_id from public.start_quest_attempt_for_participant(p_quest_id,p_participant_profile_id);
    end if;
    insert into public.offline_attempt_registrations(actor_user_id,local_attempt_id,quest_id,participant_profile_id,server_attempt_id)
      values(actor,p_local_attempt_id,p_quest_id,p_participant_profile_id,resolved_id);
  end if;
  if exists(select 1 from public.offline_start_permits where server_attempt_id=resolved_id)
    and not coalesce(p_existing_attempt_id=resolved_id and p_local_attempt_id=resolved_id::text,false) then
    raise exception 'offline permit registration required' using errcode='23505';
  end if;
  select * into attempt from public.quest_attempts where id=resolved_id for update;
  if not found then raise exception 'registered offline attempt removed' using errcode='P0001'; end if;
  if attempt.quest_id<>p_quest_id or attempt.participant_profile_id<>p_participant_profile_id then
    raise exception 'offline attempt scope mismatch' using errcode='42501';
  end if;
  -- Существующая семантика передачи управления активной попыткой контролёру.
  if attempt.finished_at is null and attempt.user_id<>actor then
    update public.quest_attempts set user_id=actor where id=resolved_id;
  end if;
  return jsonb_build_object('id',resolved_id,'quest_id',p_quest_id,'participant_profile_id',p_participant_profile_id,'finished_at',attempt.finished_at);
end;
$$;
commit;
