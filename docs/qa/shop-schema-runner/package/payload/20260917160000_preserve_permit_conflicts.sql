begin;
alter table public.offline_event_reviews add column review_reason text;
alter table public.offline_event_reviews add constraint offline_review_reason_check
  check(review_reason is null or (review_reason='permit_conflict' and state='needs_review'));

create function public.preserve_conflicting_offline_events(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_events jsonb,p_permit_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); permit public.offline_start_permits%rowtype;
  event jsonb; existing public.offline_event_reviews%rowtype; receipts jsonb:='[]'; event_id uuid;
begin
  perform pg_advisory_xact_lock_shared(16014000,1);
  p_participant_profile_id:=public.resolve_billing_participant_profile(p_participant_profile_id);
  if actor is null or not public.can_actor_access_quest(p_quest_id,p_participant_profile_id) then
    raise exception 'quest access denied' using errcode='42501'; end if;
  if p_local_attempt_id is null or length(p_local_attempt_id) not between 1 and 200 or p_permit_id is null
    or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid review batch' using errcode='22023'; end if;
  if jsonb_array_length(p_events) not between 1 and 100 or octet_length(p_events::text)>1048576 then
    raise exception 'invalid review batch' using errcode='22023'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'offline review requires read committed' using errcode='40001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':offline:'||p_local_attempt_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_participant_profile_id::text||':'||p_quest_id::text,0));
  select * into permit from public.offline_start_permits where id=p_permit_id for share;
  if not found or permit.quest_id<>p_quest_id or permit.participant_profile_id<>p_participant_profile_id then
    raise exception 'offline permit scope mismatch' using errcode='42501'; end if;
  if permit.state<>'redeemed' or permit.server_attempt_id::text=p_local_attempt_id
    or exists(select 1 from public.offline_attempt_registrations
    where actor_user_id=actor and local_attempt_id=p_local_attempt_id) then
    raise exception 'offline permit conflict not established' using errcode='23514'; end if;
  if exists(select 1 from public.offline_event_reviews where actor_user_id=actor and local_attempt_id=p_local_attempt_id
    and (quest_id<>p_quest_id or participant_profile_id<>p_participant_profile_id
      or state<>'needs_review' or review_reason is distinct from 'permit_conflict')) then
    raise exception 'offline review event conflict' using errcode='23505'; end if;
  for event in select value from jsonb_array_elements(p_events) order by value->>'clientEventId'
  loop
    if jsonb_typeof(event) is distinct from 'object' or event->>'eventType' is null
      or event->>'eventType' not in ('open','answer','finish') or event->>'clientEventId' is null
      or (event->>'taskId' is null and event->>'eventType'<>'finish')
      or exists(select 1 from public.tasks where id=(event->>'taskId')::uuid and quest_id<>p_quest_id) then
      raise exception 'invalid review event' using errcode='22023'; end if;
    event_id:=(event->>'clientEventId')::uuid;
    insert into public.offline_event_reviews(actor_user_id,quest_id,participant_profile_id,local_attempt_id,client_event_id,payload,state,review_reason)
      values(actor,p_quest_id,p_participant_profile_id,p_local_attempt_id,event_id,event,'needs_review','permit_conflict')
      on conflict(actor_user_id,client_event_id) do nothing;
    select * into existing from public.offline_event_reviews where actor_user_id=actor and client_event_id=event_id;
    if existing.quest_id<>p_quest_id or existing.participant_profile_id<>p_participant_profile_id
      or existing.local_attempt_id<>p_local_attempt_id or existing.payload<>event or existing.state<>'needs_review'
      or existing.review_reason is distinct from 'permit_conflict' then
      raise exception 'offline review event conflict' using errcode='23505'; end if;
    receipts:=receipts||jsonb_build_array(jsonb_build_object('id',existing.id,'client_event_id',event_id,'state',existing.state));
  end loop;
  return jsonb_build_object('state','needs_review','receipts',receipts);
end;
$$;
revoke all on function public.preserve_conflicting_offline_events(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.preserve_conflicting_offline_events(uuid,uuid,text,jsonb,uuid) to authenticated;

-- Обёртка сохраняет общий lock объединения профилей и существующий core.
create or replace function public.register_permitted_offline_attempt(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_permit_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved uuid; result jsonb;
begin
  perform pg_advisory_xact_lock_shared(16014000,1);
  resolved:=public.resolve_billing_participant_profile(p_participant_profile_id);
  if auth.uid() is null or not public.can_actor_access_quest(p_quest_id,resolved) then
    raise exception 'quest access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':offline:'||p_local_attempt_id,0));
  if exists(select 1 from public.offline_event_reviews where actor_user_id=auth.uid() and local_attempt_id=p_local_attempt_id
    and quest_id=p_quest_id and participant_profile_id=resolved and review_reason='permit_conflict') then
    raise exception 'offline permit conflict requires review' using errcode='P0001'; end if;
  result:=public.register_permitted_offline_attempt_core(p_quest_id,resolved,p_local_attempt_id,p_permit_id);
  if result ? 'participant_profile_id' then result:=result||jsonb_build_object('participant_profile_id',p_participant_profile_id); end if;
  return result;
end;
$$;
commit;
