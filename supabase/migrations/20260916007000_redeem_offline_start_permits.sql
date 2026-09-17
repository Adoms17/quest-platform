begin;
create or replace function public.start_quest_attempt_for_participant(
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
  completed_attempt_count integer;
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

revoke all on function public.start_quest_attempt_for_participant(uuid, uuid) from public;
grant execute on function public.start_quest_attempt_for_participant(uuid, uuid) to authenticated;

-- Старый RPC сохраняет форму ответа, но использует ту же идентичность и блокировку.
create or replace function public.start_quest_attempt(p_quest_id uuid)
returns table(id uuid,quest_id uuid,user_id uuid,started_at timestamptz,finished_at timestamptz,
 total_tasks integer,completed_tasks integer,failed_tasks integer,total_attempts integer,total_time integer,percent_success double precision)
language sql security definer set search_path='' as $$
select a.id,a.quest_id,a.user_id,a.started_at,a.finished_at,a.total_tasks,a.completed_tasks,
 a.failed_tasks,a.total_attempts,a.total_time,a.percent_success
from public.start_quest_attempt_for_participant(p_quest_id,public.current_self_participant_profile_id()) a;
$$;

create function public.redeem_offline_start_permit(p_permit_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.offline_start_permits%rowtype; a public.quest_attempts%rowtype; q public.quests%rowtype; attempt_id uuid;
begin
  select * into p from public.offline_start_permits where id=p_permit_id;
  if not found or auth.uid() is null or not public.can_actor_access_quest(p.quest_id,p.participant_profile_id) then
    raise exception 'offline permit access denied' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'offline permit requires read committed' using errcode='40001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.participant_profile_id::text||':'||p.quest_id::text,0));
  select * into q from public.quests where id=p.quest_id for share;
  select * into p from public.offline_start_permits where id=p_permit_id for update;
  if p.organization_id is distinct from q.organization_id
    or not public.can_actor_access_quest(p.quest_id,p.participant_profile_id) then
    raise exception 'offline permit access denied' using errcode='42501'; end if;
  if p.state='reserved' then
    select id into attempt_id from public.start_quest_attempt_for_participant(p.quest_id,p.participant_profile_id);
    select * into p from public.offline_start_permits where id=p_permit_id;
    if p.state<>'redeemed' or p.server_attempt_id is distinct from attempt_id then
      raise exception 'offline permit redemption mismatch' using errcode='40001'; end if;
  end if;
  select * into a from public.quest_attempts where id=p.server_attempt_id for update;
  if not found then raise exception 'redeemed offline attempt removed' using errcode='P0001'; end if;
  if a.quest_id<>p.quest_id or a.participant_profile_id<>p.participant_profile_id then
    raise exception 'offline permit scope mismatch' using errcode='42501'; end if;
  if a.finished_at is null and a.user_id<>auth.uid() then
    update public.quest_attempts set user_id=auth.uid() where id=a.id returning * into a;
  end if;
  return jsonb_build_object('id',a.id,'quest_id',a.quest_id,'participant_profile_id',a.participant_profile_id,'finished_at',a.finished_at);
end;
$$;
revoke all on function public.redeem_offline_start_permit(uuid) from public,anon,authenticated;
grant execute on function public.redeem_offline_start_permit(uuid) to service_role;
comment on function public.redeem_offline_start_permit(uuid) is
 'Закрытое погашение до подключения offline-клиента. Retry не создаёт попытку после завершения/удаления. Тарифное истечение не отменяет право; правила квеста проверяются при первом погашении.';

commit;
