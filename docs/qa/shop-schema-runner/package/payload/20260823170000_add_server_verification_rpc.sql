-- Server-owned quest attempt lifecycle and task verification events.

alter table public.quests
  add column verification_mode text not null default 'online',
  add column offline_progress_policy text not null default 'allow_pending',
  add constraint quests_verification_mode_check
    check (verification_mode in ('online', 'hybrid', 'secure_online')),
  add constraint quests_offline_progress_policy_check
    check (offline_progress_policy in ('allow_pending', 'block'));

do $function$
begin
  if exists (
    select 1
    from public.quest_attempts
    where finished_at is null
    group by quest_id, user_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce one active quest attempt: duplicate active attempts exist';
  end if;

  if exists (
    select 1
    from public.task_attempts
    group by quest_attempt_id, task_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce one task state: duplicate task attempts exist';
  end if;
end;
$function$;

create unique index quest_attempts_one_active_per_user
  on public.quest_attempts (quest_id, user_id)
  where finished_at is null;

alter table public.task_attempts
  add constraint task_attempts_quest_attempt_task_key
  unique (quest_attempt_id, task_id);

create table public.task_submission_events (
  id uuid not null default gen_random_uuid(),
  client_event_id uuid not null,
  quest_attempt_id uuid not null,
  task_id uuid not null,
  event_type text not null,
  submitted_value text,
  client_elapsed_seconds integer,
  server_state jsonb not null,
  created_at timestamp with time zone not null default now(),
  constraint task_submission_events_pkey primary key (id),
  constraint task_submission_events_client_event_id_key unique (client_event_id),
  constraint task_submission_events_event_type_check
    check (event_type in ('open', 'answer')),
  constraint task_submission_events_client_elapsed_check
    check (client_elapsed_seconds is null or client_elapsed_seconds >= 0),
  constraint task_submission_events_quest_attempt_fkey
    foreign key (quest_attempt_id)
    references public.quest_attempts(id)
    on delete cascade,
  constraint task_submission_events_task_fkey
    foreign key (task_id)
    references public.tasks(id)
    on delete cascade
);

alter table public.task_submission_events enable row level security;

revoke all on table public.task_submission_events from public, anon, authenticated;
grant all on table public.task_submission_events to service_role;

create or replace function public.get_participant_tasks(p_quest_id uuid)
returns table (
  id uuid,
  quest_id uuid,
  title text,
  description text,
  hint text,
  image_url text,
  order_index integer,
  options jsonb,
  media_url text,
  location_text text,
  location_image_url text,
  media jsonb,
  requires_answer boolean,
  requires_code boolean,
  requires_gps boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not exists (
    select 1
    from public.quests
    where quests.id = p_quest_id
      and (quests.is_public or quests.creator_id = auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  return query
  select
    tasks.id,
    tasks.quest_id,
    tasks.title,
    tasks.description,
    tasks.hint,
    tasks.image_url,
    tasks.order_index,
    tasks.options,
    tasks.media_url,
    tasks.location_text,
    tasks.location_image_url,
    tasks.media,
    nullif(btrim(tasks.correct_answer), '') is not null,
    (quests.verification_options ? 'code')
      and nullif(btrim(tasks.static_code), '') is not null,
    (quests.verification_options ? 'gps')
      and tasks.gps_point is not null
  from public.tasks
  join public.quests on quests.id = tasks.quest_id
  where tasks.quest_id = p_quest_id
  order by tasks.order_index, tasks.id;
end;
$function$;

create or replace function public.start_quest_attempt(p_quest_id uuid)
returns table (
  id uuid,
  quest_id uuid,
  user_id uuid,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  total_tasks integer,
  completed_tasks integer,
  failed_tasks integer,
  total_attempts integer,
  total_time integer,
  percent_success double precision
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  quest_record public.quests%rowtype;
  attempt_record public.quest_attempts%rowtype;
  task_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select *
  into quest_record
  from public.quests
  where quests.id = p_quest_id;

  if not found
     or not (quest_record.is_public or quest_record.creator_id = current_user_id)
  then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  if not coalesce(quest_record.is_open, true)
     or (quest_record.start_at is not null and quest_record.start_at > now())
     or (quest_record.end_at is not null and quest_record.end_at < now())
  then
    raise exception using errcode = '23514', message = 'quest is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || p_quest_id::text, 0)
  );

  select *
  into attempt_record
  from public.quest_attempts
  where quest_attempts.quest_id = p_quest_id
    and quest_attempts.user_id = current_user_id
    and quest_attempts.finished_at is null
  for update;

  if not found then
    select count(*)::integer
    into task_count
    from public.tasks
    where tasks.quest_id = p_quest_id;

    insert into public.quest_attempts (quest_id, user_id, total_tasks)
    values (p_quest_id, current_user_id, task_count)
    returning * into attempt_record;
  end if;

  return query
  select
    attempt_record.id,
    attempt_record.quest_id,
    attempt_record.user_id,
    attempt_record.started_at,
    attempt_record.finished_at,
    attempt_record.total_tasks,
    attempt_record.completed_tasks,
    attempt_record.failed_tasks,
    attempt_record.total_attempts,
    attempt_record.total_time,
    attempt_record.percent_success;
end;
$function$;

create or replace function public.submit_task_event(
  p_quest_attempt_id uuid,
  p_task_id uuid,
  p_client_event_id uuid,
  p_event_type text,
  p_submitted_value text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_client_elapsed_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  attempt_record public.quest_attempts%rowtype;
  quest_record public.quests%rowtype;
  task_record public.tasks%rowtype;
  task_attempt_record public.task_attempts%rowtype;
  existing_event public.task_submission_events%rowtype;
  gps_required boolean;
  code_required boolean;
  gps_ok boolean;
  code_ok boolean;
  answer_correct boolean;
  event_accepted boolean := true;
  task_terminal boolean;
  task_count integer;
  completed_count integer;
  failed_count integer;
  attempt_count integer;
  time_count integer;
  response jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'client_event_id is required';
  end if;

  if p_event_type not in ('open', 'answer') then
    raise exception using errcode = '22023', message = 'unsupported task event type';
  end if;

  if p_client_elapsed_seconds is not null and p_client_elapsed_seconds < 0 then
    raise exception using errcode = '22023', message = 'client elapsed time cannot be negative';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_client_event_id::text, 0)
  );

  select events.*
  into existing_event
  from public.task_submission_events as events
  where events.client_event_id = p_client_event_id;

  if found then
    if existing_event.quest_attempt_id = p_quest_attempt_id
       and existing_event.task_id = p_task_id
       and existing_event.event_type = p_event_type
       and exists (
         select 1
         from public.quest_attempts
         where quest_attempts.id = existing_event.quest_attempt_id
           and quest_attempts.user_id = current_user_id
       )
    then
      return existing_event.server_state;
    end if;

    raise exception using errcode = '23505', message = 'client_event_id already used';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_quest_attempt_id::text || ':' || p_task_id::text, 0)
  );

  select *
  into attempt_record
  from public.quest_attempts
  where quest_attempts.id = p_quest_attempt_id
    and quest_attempts.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'quest attempt access denied';
  end if;

  if attempt_record.finished_at is not null then
    raise exception using errcode = '23514', message = 'quest attempt is already finished';
  end if;

  select *
  into quest_record
  from public.quests
  where quests.id = attempt_record.quest_id;

  select *
  into task_record
  from public.tasks
  where tasks.id = p_task_id;

  if not found or task_record.quest_id is distinct from attempt_record.quest_id then
    raise exception using errcode = '23514', message = 'task attempt quest mismatch';
  end if;

  select *
  into task_attempt_record
  from public.task_attempts
  where task_attempts.quest_attempt_id = p_quest_attempt_id
    and task_attempts.task_id = p_task_id
  for update;

  if not found then
    insert into public.task_attempts (
      quest_attempt_id,
      task_id,
      opened,
      attempts_used,
      completed,
      failed,
      time_spent
    )
    values (
      p_quest_attempt_id,
      p_task_id,
      false,
      0,
      false,
      false,
      0
    )
    returning * into task_attempt_record;
  end if;

  if task_attempt_record.completed or task_attempt_record.failed then
    event_accepted := false;
    answer_correct := task_attempt_record.completed;
  elsif p_event_type = 'open' then
    gps_required := (quest_record.verification_options ? 'gps')
      and task_record.gps_point is not null;
    code_required := (quest_record.verification_options ? 'code')
      and nullif(btrim(task_record.static_code), '') is not null;

    gps_ok := not gps_required or (
      p_latitude is not null
      and p_longitude is not null
      and public.st_dwithin(
        task_record.gps_point::public.geography,
        public.st_setsrid(public.st_makepoint(p_longitude, p_latitude), 4326)::public.geography,
        50
      )
    );
    code_ok := not code_required or (
      p_submitted_value is not null
      and upper(btrim(p_submitted_value)) = upper(btrim(task_record.static_code))
    );

    event_accepted := gps_ok and code_ok;

    if event_accepted then
      update public.task_attempts
      set opened = true
      where task_attempts.id = task_attempt_record.id
      returning * into task_attempt_record;
    end if;
  else
    if not task_attempt_record.opened then
      raise exception using errcode = '23514', message = 'task is not opened';
    end if;

    if nullif(btrim(task_record.correct_answer), '') is not null
       and nullif(btrim(p_submitted_value), '') is null
    then
      raise exception using errcode = '22023', message = 'answer is required';
    end if;

    answer_correct := nullif(btrim(task_record.correct_answer), '') is null
      or lower(btrim(p_submitted_value)) = lower(btrim(task_record.correct_answer));

    update public.task_attempts
    set
      attempts_used = task_attempts.attempts_used + 1,
      completed = answer_correct,
      failed = not answer_correct
        and quest_record.max_attempts > 0
        and task_attempts.attempts_used + 1 >= quest_record.max_attempts,
      time_spent = greatest(
        task_attempts.time_spent,
        floor(extract(epoch from (now() - task_attempts.created_at)))::integer
      )
    where task_attempts.id = task_attempt_record.id
    returning * into task_attempt_record;
  end if;

  select count(*)::integer
  into task_count
  from public.tasks
  where tasks.quest_id = attempt_record.quest_id;

  select
    count(*) filter (where task_attempts.completed)::integer,
    count(*) filter (where task_attempts.failed)::integer,
    coalesce(sum(task_attempts.attempts_used), 0)::integer,
    coalesce(sum(task_attempts.time_spent), 0)::integer
  into completed_count, failed_count, attempt_count, time_count
  from public.task_attempts
  where task_attempts.quest_attempt_id = p_quest_attempt_id;

  update public.quest_attempts
  set
    total_tasks = task_count,
    completed_tasks = completed_count,
    failed_tasks = failed_count,
    total_attempts = attempt_count,
    total_time = time_count,
    percent_success = case
      when task_count > 0 then completed_count::double precision / task_count * 100
      else 0
    end,
    finished_at = case
      when task_count > 0 and completed_count + failed_count >= task_count
        then coalesce(quest_attempts.finished_at, now())
      else null
    end
  where quest_attempts.id = p_quest_attempt_id
  returning * into attempt_record;

  task_terminal := task_attempt_record.completed or task_attempt_record.failed;

  response := jsonb_build_object(
    'client_event_id', p_client_event_id,
    'task_attempt_id', task_attempt_record.id,
    'opened', task_attempt_record.opened,
    'accepted', event_accepted,
    'correct', answer_correct,
    'completed', task_attempt_record.completed,
    'failed', task_attempt_record.failed,
    'terminal', task_terminal,
    'attempts_used', task_attempt_record.attempts_used,
    'remaining_attempts', case
      when quest_record.max_attempts > 0
        then greatest(quest_record.max_attempts - task_attempt_record.attempts_used, 0)
      else null
    end,
    'quest_attempt', jsonb_build_object(
      'id', attempt_record.id,
      'total_tasks', attempt_record.total_tasks,
      'completed_tasks', attempt_record.completed_tasks,
      'failed_tasks', attempt_record.failed_tasks,
      'total_attempts', attempt_record.total_attempts,
      'total_time', attempt_record.total_time,
      'percent_success', attempt_record.percent_success,
      'finished_at', attempt_record.finished_at
    )
  );

  insert into public.task_submission_events (
    client_event_id,
    quest_attempt_id,
    task_id,
    event_type,
    submitted_value,
    client_elapsed_seconds,
    server_state
  )
  values (
    p_client_event_id,
    p_quest_attempt_id,
    p_task_id,
    p_event_type,
    p_submitted_value,
    p_client_elapsed_seconds,
    response
  );

  return response;
end;
$function$;

revoke execute on function public.get_participant_tasks(uuid)
  from public, anon;
revoke execute on function public.start_quest_attempt(uuid)
  from public, anon;
revoke execute on function public.submit_task_event(
  uuid, uuid, uuid, text, text, double precision, double precision, integer
) from public, anon;

grant execute on function public.get_participant_tasks(uuid)
  to authenticated, service_role;
grant execute on function public.start_quest_attempt(uuid)
  to authenticated, service_role;
grant execute on function public.submit_task_event(
  uuid, uuid, uuid, text, text, double precision, double precision, integer
) to authenticated, service_role;
