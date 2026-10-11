begin;
create or replace function public.preserve_closed_offline_events_core(p_quest_id uuid,p_participant_profile_id uuid,p_local_attempt_id text,p_events jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.quests%rowtype; event jsonb;
 subscription public.organization_subscriptions%rowtype; billing_blocked boolean:=false; existing public.offline_event_reviews%rowtype; receipts jsonb:='[]'; event_id uuid;
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
 select * into subscription from public.organization_subscriptions where organization_id=q.organization_id for share;
 billing_blocked:=coalesce(subscription.quest_start_enforcement_enabled,false) and (public.resolve_subscription_quota_phase(subscription,clock_timestamp())->>'phase') not in ('free','active','trial','grace','transition');
 -- Это отдельная доставка на проверку, не попытка и не подтверждение ответа.
 for event in select value from jsonb_array_elements(p_events) order by value->>'clientEventId'
 loop
   if jsonb_typeof(event) is distinct from 'object' or event->>'eventType' not in ('open','answer','finish')
     or event->>'eventType' is null or event->>'clientEventId' is null
     or (event->>'taskId' is null and event->>'eventType'<>'finish')
     or exists(select 1 from public.tasks where id=(event->>'taskId')::uuid and quest_id<>p_quest_id) then
     raise exception 'invalid review event' using errcode='22023'; end if;
   event_id:=(event->>'clientEventId')::uuid;
   if coalesce(q.is_open,true) and (q.end_at is null or q.end_at>=clock_timestamp()) and not billing_blocked
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

commit;
