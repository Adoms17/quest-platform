begin;
create table public.offline_event_reviews (
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid not null,
 quest_id uuid not null,
 participant_profile_id uuid not null,
 local_attempt_id text not null,
 client_event_id uuid not null,
 payload jsonb not null,
 state text not null default 'needs_review' check(state='needs_review'),
 received_at timestamptz not null default clock_timestamp(),
 unique(actor_user_id,client_event_id)
);
create index offline_event_reviews_quest on public.offline_event_reviews(quest_id,received_at,id);
alter table public.offline_event_reviews enable row level security;
revoke all on public.offline_event_reviews from public,anon,authenticated;

create function public.preserve_closed_offline_events(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_events jsonb)
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
   if coalesce(q.is_open,true) and (q.end_at is null or q.end_at>=clock_timestamp())
     and not exists(select 1 from public.offline_event_reviews where actor_user_id=actor and client_event_id=event_id) then
     raise exception 'quest does not require offline review' using errcode='23514'; end if;
   insert into public.offline_event_reviews(actor_user_id,quest_id,participant_profile_id,local_attempt_id,client_event_id,payload)
     values(actor,p_quest_id,p_participant_profile_id,p_local_attempt_id,event_id,event)
     on conflict(actor_user_id,client_event_id) do nothing;
   select * into existing from public.offline_event_reviews where actor_user_id=actor and client_event_id=event_id;
   if existing.quest_id<>p_quest_id or existing.participant_profile_id<>p_participant_profile_id
     or existing.local_attempt_id<>p_local_attempt_id or existing.payload<>event then
     raise exception 'offline review event conflict' using errcode='23505'; end if;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('id',existing.id,'client_event_id',event_id,'state',existing.state));
 end loop;
 return jsonb_build_object('state','needs_review','receipts',receipts);
end;
$$;
revoke all on function public.preserve_closed_offline_events(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.preserve_closed_offline_events(uuid,uuid,text,jsonb) to authenticated;

create function public.list_offline_event_reviews(p_quest_id uuid,p_after uuid default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if auth.uid() is null or not public.has_quest_permission(p_quest_id,'quest_stats.read') then
   raise exception 'quest statistics access denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   select id,participant_profile_id,local_attempt_id,client_event_id,payload,state,received_at,
     (select display_name from public.participant_profiles where id=participant_profile_id) as participant_name
   from public.offline_event_reviews where quest_id=p_quest_id and (p_after is null or id>p_after)
   order by id limit least(greatest(coalesce(p_limit,25),1),50)
 ) r;
 return rows;
end;
$$;
revoke all on function public.list_offline_event_reviews(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_offline_event_reviews(uuid,uuid,integer) to authenticated;
commit;
