-- An explicit opt-in to trust offline event timestamps; strict by default.
alter table public.quests add column allow_late_offline_answers boolean not null default false;
alter table public.quest_attempts add column allow_late_offline_answers boolean not null default false;

create or replace function public.set_quest_attempt_deadline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare minutes integer; allow_late boolean;
begin
  select time_limit_minutes, allow_late_offline_answers into minutes, allow_late
  from public.quests where id = new.quest_id;
  new.deadline_at := case when minutes > 0 then new.started_at + pg_catalog.make_interval(mins => minutes) else null end;
  new.allow_late_offline_answers := coalesce(allow_late, false);
  return new;
end;
$$;

do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.get_participant_quest(uuid)', 'public.get_participant_quest_for_profile(uuid,uuid)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('''time_limit_minutes'', quest.time_limit_minutes,' in definition) = 0 then raise exception 'quest projection not found'; end if;
    execute replace(definition, '''time_limit_minutes'', quest.time_limit_minutes,', '''time_limit_minutes'', quest.time_limit_minutes, ''allow_late_offline_answers'', quest.allow_late_offline_answers,');
  end loop;
end;
$$;

create function public.submit_offline_task_event(
  p_quest_attempt_id uuid, p_task_id uuid, p_client_event_id uuid, p_event_type text,
  p_recorded_at timestamptz,
  p_submitted_value text default null, p_latitude double precision default null,
  p_longitude double precision default null, p_client_elapsed_seconds integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt public.quest_attempts%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='authentication required'; end if;
  if p_client_event_id is null then raise exception using errcode='22023', message='client_event_id required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_event_id::text,0));
  select * into attempt from public.quest_attempts
  where id=p_quest_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception using errcode='42501', message='quest attempt access denied'; end if;

  if attempt.allow_late_offline_answers and attempt.deadline_at is not null
    and p_recorded_at >= attempt.started_at and p_recorded_at <= attempt.deadline_at
    and p_recorded_at <= clock_timestamp() then
    -- This preserves authorization, answer validation, attempt limits and receipts.
    -- Completed attempts remain closed; only the receipt of the original event can replay.
    return public.submit_task_event_before_time_limit(
      p_quest_attempt_id,p_task_id,p_client_event_id,p_event_type,p_submitted_value,
      p_latitude,p_longitude,p_client_elapsed_seconds);
  end if;
  return public.submit_task_event(
    p_quest_attempt_id,p_task_id,p_client_event_id,p_event_type,p_submitted_value,
    p_latitude,p_longitude,p_client_elapsed_seconds);
end;
$$;
revoke all on function public.submit_offline_task_event(uuid,uuid,uuid,text,timestamptz,text,double precision,double precision,integer) from public, anon;
grant execute on function public.submit_offline_task_event(uuid,uuid,uuid,text,timestamptz,text,double precision,double precision,integer) to authenticated;
