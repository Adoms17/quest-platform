begin;
-- Отказ по лимиту сохраняется вне зачтённых попыток и статистики.
alter table public.offline_event_reviews drop constraint offline_event_reviews_state_check;
alter table public.offline_event_reviews add constraint offline_event_reviews_state_check check(state in ('needs_review','invalid_limit'));
create index offline_event_reviews_profile_history on public.offline_event_reviews(participant_profile_id,actor_user_id,local_attempt_id,received_at,id) where state='invalid_limit';
create or replace function public.preserve_limit_rejected_offline_events(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_events jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.quests%rowtype; event jsonb;
 existing public.offline_event_reviews%rowtype; receipts jsonb:='[]'; event_id uuid;
begin
 if actor is null or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
   raise exception 'quest access denied' using errcode='42501'; end if;
 if p_local_attempt_id is null or length(p_local_attempt_id) not between 1 and 200
   or jsonb_typeof(p_events) is distinct from 'array' then
   raise exception 'invalid review batch' using errcode='22023'; end if;
 if jsonb_array_length(p_events) not between 1 and 100 or octet_length(p_events::text)>1048576 then
   raise exception 'invalid review batch' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':offline:'||p_local_attempt_id,0));
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'offline rejection requires read committed' using errcode='40001'; end if;
 if exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id
   and (quest_id<>p_quest_id or participant_profile_id<>p_participant_profile_id or state<>'invalid_limit')) then
   raise exception 'offline review event conflict' using errcode='23505'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_participant_profile_id::text||':'||p_quest_id::text,0));
 select * into q from public.quests where id=p_quest_id for share;
 if not found or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
   raise exception 'quest access denied' using errcode='42501'; end if;
 -- Это отдельная доставка на проверку, не попытка и не подтверждение ответа.
 for event in select value from jsonb_array_elements(p_events) order by value->>'clientEventId'
 loop
   if jsonb_typeof(event) is distinct from 'object' or event->>'eventType' not in ('open','answer','finish')
     or event->>'eventType' is null or event->>'clientEventId' is null
     or (event->>'taskId' is null and event->>'eventType'<>'finish')
     or exists(select 1 from public.tasks where id=(event->>'taskId')::uuid and quest_id<>p_quest_id) then
     raise exception 'invalid review event' using errcode='22023'; end if;
   event_id:=(event->>'clientEventId')::uuid;
   if not exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id and quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and state='invalid_limit') then
     if exists(select 1 from public.offline_attempt_registrations where actor_user_id=actor and local_attempt_id=p_local_attempt_id)
       or exists(select 1 from public.quest_attempts where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and finished_at is null)
       or coalesce(q.max_quest_attempts,0)<=0
       or (select count(*) from public.quest_attempts where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and finished_at is not null)<q.max_quest_attempts then
       raise exception 'quest completion limit not reached' using errcode='23514'; end if;
   end if;
   insert into public.offline_event_reviews(actor_user_id,quest_id,participant_profile_id,local_attempt_id,client_event_id,payload,state)
     values(actor,p_quest_id,p_participant_profile_id,p_local_attempt_id,event_id,event,'invalid_limit')
     on conflict(actor_user_id,client_event_id) do nothing;
   select * into existing from public.offline_event_reviews where actor_user_id=actor and client_event_id=event_id;
   if existing.quest_id<>p_quest_id or existing.participant_profile_id<>p_participant_profile_id
     or existing.local_attempt_id<>p_local_attempt_id or existing.payload<>event or existing.state<>'invalid_limit' then
     raise exception 'offline review event conflict' using errcode='23505'; end if;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('id',existing.id,'client_event_id',event_id,'state',existing.state));
 end loop;
 return jsonb_build_object('state','invalid_limit','receipts',receipts);
end;
$$;
revoke all on function public.preserve_limit_rejected_offline_events(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.preserve_limit_rejected_offline_events(uuid,uuid,text,jsonb) to authenticated;


create or replace function public.register_offline_quest_attempt(p_quest_id uuid, p_participant_profile_id uuid, p_local_attempt_id text, p_existing_attempt_id uuid)
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
  if exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id and state='invalid_limit') then
    raise exception 'offline attempt rejected by limit' using errcode='P0001'; end if;
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
  if exists(select 1 from public.offline_start_permits where server_attempt_id=resolved_id) then
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
create or replace function public.register_permitted_offline_attempt(
  p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_permit_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.offline_start_permits%rowtype;
  r public.offline_attempt_registrations%rowtype; result jsonb;
begin
  if actor is null or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
    raise exception 'quest access denied' using errcode='42501'; end if;
  if p_local_attempt_id is null or length(p_local_attempt_id) not between 1 and 200 or p_permit_id is null then
    raise exception 'invalid offline permit registration' using errcode='22023'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'offline permit requires read committed' using errcode='40001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':offline:'||p_local_attempt_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_participant_profile_id::text||':'||p_quest_id::text,0));
  if exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id and state='invalid_limit') then
    raise exception 'offline attempt rejected by limit' using errcode='P0001'; end if;
  if exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id) then
    raise exception 'offline attempt requires review' using errcode='P0001'; end if;
  select * into p from public.offline_start_permits where id=p_permit_id;
  if not found or p.quest_id<>p_quest_id or p.participant_profile_id<>p_participant_profile_id then
    raise exception 'offline permit scope mismatch' using errcode='42501'; end if;
  select * into r from public.offline_attempt_registrations where actor_user_id=actor and local_attempt_id=p_local_attempt_id;
  if found then
    if r.quest_id<>p_quest_id or r.participant_profile_id<>p_participant_profile_id or r.permit_id is distinct from p_permit_id
      or r.server_attempt_id is distinct from p.server_attempt_id then
      raise exception 'offline permit registration conflict' using errcode='23505'; end if;
    return public.redeem_offline_start_permit(p_permit_id);
  end if;
  -- Первое связывание возможно только до погашения. Иначе это другая локальная
  -- история или online-старт: нельзя автоматически присоединять её события.
  if p.state<>'reserved' or exists(select 1 from public.offline_attempt_registrations where permit_id=p_permit_id) then
    raise exception 'offline permit already bound' using errcode='23505'; end if;
  result:=public.redeem_offline_start_permit(p_permit_id);
  insert into public.offline_attempt_registrations(actor_user_id,local_attempt_id,quest_id,participant_profile_id,server_attempt_id,permit_id)
    values(actor,p_local_attempt_id,p_quest_id,p_participant_profile_id,(result->>'id')::uuid,p_permit_id);
  return result;
end;
$$;

-- Phase 5: expose a privacy-preserving task summary for participant navigation.

create or replace function public.get_participant_quest_summary(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  quest_record public.quests%rowtype;
  attempt_record public.quest_attempts%rowtype;
  task_count integer;
  visible_task_list jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  select * into quest_record
  from public.quests quest
  where quest.id = p_quest_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'quest not found';
  end if;

  select * into attempt_record
  from public.quest_attempts attempt
  where attempt.quest_id = p_quest_id
    and attempt.participant_profile_id = p_participant_profile_id
    and attempt.finished_at is null
  order by attempt.started_at desc, attempt.id
  limit 1;

  select count(*)::integer into task_count
  from public.tasks task
  where task.quest_id = p_quest_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', visible.task_id,
        'order_index', visible.order_index,
        'title', visible.title,
        'status', visible.task_status,
        'has_coordinates', visible.has_coordinates
      ) order by visible.order_index, visible.task_id
    ),
    '[]'::jsonb
  ) into visible_task_list
  from (
    select
      task.id as task_id,
      task.order_index,
      task.title,
      task.gps_point is not null as has_coordinates,
      case
        when task_attempt.completed then 'completed'
        when task_attempt.failed then 'failed'
        when task_attempt.opened then 'in_progress'
        else 'available'
      end as task_status
    from public.tasks task
    left join public.task_attempts task_attempt
      on task_attempt.quest_attempt_id = attempt_record.id
      and task_attempt.task_id = task.id
    where task.quest_id = p_quest_id
      and (
        quest_record.task_navigation_mode = 'free'
        or coalesce(task_attempt.completed or task_attempt.failed, false)
        or task.id = (
          select next_task.id
          from public.tasks next_task
          left join public.task_attempts next_attempt
            on next_attempt.quest_attempt_id = attempt_record.id
            and next_attempt.task_id = next_task.id
          where next_task.quest_id = p_quest_id
            and not coalesce(next_attempt.completed or next_attempt.failed, false)
          order by next_task.order_index, next_task.id
          limit 1
        )
      )
  ) visible;

  return jsonb_build_object(
    'completion_limit_reached', attempt_record.id is null and quest_record.max_quest_attempts > 0 and (select count(*) from public.quest_attempts where quest_id=p_quest_id and participant_profile_id=p_participant_profile_id and finished_at is not null)>=quest_record.max_quest_attempts,
    'quest_id', quest_record.id,
    'navigation_mode', quest_record.task_navigation_mode,
    'total_tasks', task_count,
    'active_attempt_id', attempt_record.id,
    'completed_tasks', coalesce(attempt_record.completed_tasks, 0),
    'failed_tasks', coalesce(attempt_record.failed_tasks, 0),
    'tasks', visible_task_list
  );
end;
$$;

revoke all on function public.get_participant_quest_summary(uuid, uuid) from public, anon;
grant execute on function public.get_participant_quest_summary(uuid, uuid) to authenticated;
grant execute on function public.get_participant_quest_summary(uuid, uuid) to service_role;

create or replace function public.search_participant_quest_history(
  p_participant_profile_id uuid, p_after jsonb default null, p_limit integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,25),1),50);
  v_date timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if auth.uid() is null or not public.can_access_participant_profile(p_participant_profile_id) then
    raise exception using errcode='42501', message='participant history access denied';
  end if;
  if p_after is not null then
    if jsonb_typeof(p_after) is distinct from 'object'
      or p_after->>'actor_id' is distinct from auth.uid()::text
      or p_after->>'profile_id' is distinct from p_participant_profile_id::text
      or not (p_after ? 'started_at') or nullif(p_after->>'id','') is null then
      raise exception using errcode='22023',message='invalid history cursor';
    end if;
    begin
      v_id := (p_after->>'id')::uuid;
      v_date := coalesce((p_after->>'started_at')::timestamptz,'infinity'::timestamptz);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='invalid history cursor';
    end;
  end if;
  with invalid as (
    select distinct on (actor_user_id,local_attempt_id) id,quest_id,received_at
    from public.offline_event_reviews where participant_profile_id=p_participant_profile_id and state='invalid_limit'
    order by actor_user_id,local_attempt_id,received_at,id
  ), entries as (
    select a.id, a.quest_id,a.started_at,a.finished_at,a.total_tasks,a.completed_tasks,a.failed_tasks,a.total_attempts,a.total_time,a.percent_success,'valid'::text as outcome
    from public.quest_attempts a where a.participant_profile_id=p_participant_profile_id
    union all
    select id,quest_id,received_at,received_at,0,0,0,0,0,0::double precision,'invalid_limit' from invalid
  ), page as (
    select a.id quest_attempt_id, q.id quest_id, q.title quest_title,
      a.started_at, a.finished_at, a.total_tasks, a.completed_tasks, a.failed_tasks,
      a.total_attempts, a.total_time, a.percent_success, a.outcome
    from entries a join public.quests q on q.id=a.quest_id
    where (p_after is null or (coalesce(a.started_at,'infinity'::timestamptz),a.id)<(v_date,v_id))
    order by coalesce(a.started_at,'infinity'::timestamptz) desc,a.id desc limit v_limit+1
  ) select coalesce(jsonb_agg(to_jsonb(page) order by coalesce(started_at,'infinity'::timestamptz) desc,quest_attempt_id desc),'[]'::jsonb)
    into v_rows from page;
  v_more := jsonb_array_length(v_rows)>v_limit;
  if v_more then v_rows:=v_rows-v_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('items',v_rows,'has_more',v_more,'next_cursor',case when v_more then
    jsonb_build_object('actor_id',auth.uid(),'profile_id',p_participant_profile_id,'id',v_last->>'quest_attempt_id','started_at',v_last->'started_at') else null end);
end;
$$;
revoke all on function public.search_participant_quest_history(uuid,jsonb,integer) from public,anon;
grant execute on function public.search_participant_quest_history(uuid,jsonb,integer) to authenticated;

commit;
