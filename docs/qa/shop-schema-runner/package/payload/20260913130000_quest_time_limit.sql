alter table public.quests add column time_limit_minutes integer not null default 0 check (time_limit_minutes between 0 and 10080);
alter table public.quest_attempts add column deadline_at timestamptz;

create function public.set_quest_attempt_deadline() returns trigger language plpgsql security definer set search_path = '' as $$
declare minutes integer;
begin
  select time_limit_minutes into minutes from public.quests where id = new.quest_id;
  new.deadline_at := case when minutes > 0 then new.started_at + pg_catalog.make_interval(mins => minutes) else null end;
  return new;
end;
$$;
revoke all on function public.set_quest_attempt_deadline() from public, anon, authenticated;
create trigger quest_attempt_deadline before insert on public.quest_attempts for each row execute function public.set_quest_attempt_deadline();

-- Extend the explicit safe quest projections without changing their authorization.
do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.get_participant_quest(uuid)', 'public.get_participant_quest_for_profile(uuid,uuid)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('''max_quest_attempts'', quest.max_quest_attempts,' in definition) = 0 then raise exception 'quest projection not found'; end if;
    execute replace(definition, '''max_quest_attempts'', quest.max_quest_attempts,', '''max_quest_attempts'', quest.max_quest_attempts, ''time_limit_minutes'', quest.time_limit_minutes,');
  end loop;
end;
$$;

create function public.get_quest_attempt_clock(p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt public.quest_attempts%rowtype;
begin
  select * into attempt from public.quest_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then raise exception using errcode = '42501', message = 'quest attempt access denied'; end if;
  return jsonb_build_object('started_at', attempt.started_at, 'deadline_at', attempt.deadline_at, 'server_now', clock_timestamp());
end;
$$;
revoke all on function public.get_quest_attempt_clock(uuid) from public, anon;
grant execute on function public.get_quest_attempt_clock(uuid) to authenticated;

alter function public.submit_task_event(uuid,uuid,uuid,text,text,double precision,double precision,integer) rename to submit_task_event_before_time_limit;
revoke all on function public.submit_task_event_before_time_limit(uuid,uuid,uuid,text,text,double precision,double precision,integer) from public, anon, authenticated, service_role;
create function public.submit_task_event(p_quest_attempt_id uuid,p_task_id uuid,p_client_event_id uuid,p_event_type text,p_submitted_value text default null,p_latitude double precision default null,p_longitude double precision default null,p_client_elapsed_seconds integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt public.quest_attempts%rowtype; receipt public.task_submission_events%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='authentication required'; end if;
  if p_client_event_id is null or p_event_type not in ('open','answer') then raise exception using errcode='22023', message='invalid task event'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_event_id::text,0));
  select * into attempt from public.quest_attempts where id=p_quest_attempt_id and user_id=auth.uid() for update;
  if not found or not public.can_actor_access_quest(attempt.quest_id,attempt.participant_profile_id) then raise exception using errcode='42501', message='quest attempt access denied'; end if;
  select * into receipt from public.task_submission_events where client_event_id=p_client_event_id;
  if found then
    if receipt.quest_attempt_id<>p_quest_attempt_id or receipt.task_id<>p_task_id or receipt.event_type<>p_event_type then raise exception using errcode='23505',message='client_event_id already used'; end if;
    return receipt.server_state;
  end if;
  if attempt.deadline_at is not null and clock_timestamp() >= attempt.deadline_at then
    if not exists(select 1 from public.tasks where id=p_task_id and quest_id=attempt.quest_id) then raise exception using errcode='23514', message='task attempt quest mismatch'; end if;
    update public.quest_attempts set finished_at=coalesce(finished_at,deadline_at) where id=attempt.id returning * into attempt;
    result := jsonb_build_object('accepted',false,'reason','time_limit_reached','quest_attempt',to_jsonb(attempt));
    insert into public.task_submission_events(client_event_id,quest_attempt_id,task_id,event_type,server_state) values(p_client_event_id,attempt.id,p_task_id,p_event_type,result);
    return result;
  end if;
  return public.submit_task_event_before_time_limit(p_quest_attempt_id,p_task_id,p_client_event_id,p_event_type,p_submitted_value,p_latitude,p_longitude,p_client_elapsed_seconds);
end;
$$;
revoke all on function public.submit_task_event(uuid,uuid,uuid,text,text,double precision,double precision,integer) from public, anon;
grant execute on function public.submit_task_event(uuid,uuid,uuid,text,text,double precision,double precision,integer) to authenticated, service_role;
