-- Profile-scoped quest loading and attempt creation for shared devices.

create or replace function public.get_participant_quest_for_profile(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare result jsonb;
begin
  if not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;
  select to_jsonb(quest) into result from public.quests quest where quest.id = p_quest_id;
  return result;
end;
$$;

create or replace function public.get_participant_tasks_for_profile(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
returns table (
  id uuid, quest_id uuid, title text, description text, hint text, image_url text,
  order_index integer, options jsonb, media_url text, location_text text,
  location_image_url text, media jsonb, requires_answer boolean,
  requires_code boolean, requires_gps boolean, answer_verifier jsonb, code_verifier jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;
  return query
  select tasks.id, tasks.quest_id, tasks.title, tasks.description, tasks.hint,
    tasks.image_url, tasks.order_index, tasks.options, tasks.media_url,
    tasks.location_text, tasks.location_image_url, tasks.media,
    nullif(btrim(tasks.correct_answer), '') is not null,
    (quests.verification_options ? 'code') and nullif(btrim(tasks.static_code), '') is not null,
    (quests.verification_options ? 'gps') and tasks.gps_point is not null,
    case when quests.verification_mode = 'hybrid' then tasks.answer_client_verifier else null end,
    case when quests.verification_mode = 'hybrid' then tasks.code_client_verifier else null end
  from public.tasks join public.quests on quests.id = tasks.quest_id
  where tasks.quest_id = p_quest_id order by tasks.order_index, tasks.id;
end;
$$;

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
  completed_attempt_count integer;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  select * into quest_record from public.quests where quests.id = p_quest_id;
  if not found or not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;
  if not coalesce(quest_record.is_open, true)
    or (quest_record.start_at is not null and quest_record.start_at > now())
    or (quest_record.end_at is not null and quest_record.end_at < now()) then
    raise exception using errcode = '23514', message = 'quest is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_participant_profile_id::text || ':' || p_quest_id::text, 0)
  );
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
    select count(*)::integer into task_count from public.tasks where tasks.quest_id = p_quest_id;
    insert into public.quest_attempts (
      quest_id, user_id, actor_user_id, participant_profile_id, total_tasks
    ) values (
      p_quest_id, current_user_id, current_user_id, p_participant_profile_id, task_count
    ) returning * into attempt_record;
  end if;

  return query select attempt_record.id, attempt_record.quest_id, attempt_record.user_id,
    attempt_record.participant_profile_id, attempt_record.started_at, attempt_record.finished_at,
    attempt_record.total_tasks, attempt_record.completed_tasks, attempt_record.failed_tasks,
    attempt_record.total_attempts, attempt_record.total_time, attempt_record.percent_success;
end;
$$;

revoke all on function public.get_participant_quest_for_profile(uuid, uuid) from public;
revoke all on function public.get_participant_tasks_for_profile(uuid, uuid) from public;
revoke all on function public.start_quest_attempt_for_participant(uuid, uuid) from public;
grant execute on function public.get_participant_quest_for_profile(uuid, uuid) to authenticated;
grant execute on function public.get_participant_tasks_for_profile(uuid, uuid) to authenticated;
grant execute on function public.start_quest_attempt_for_participant(uuid, uuid) to authenticated;
