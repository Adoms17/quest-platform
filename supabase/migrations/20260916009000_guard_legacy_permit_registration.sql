begin;
create index offline_start_permit_attempt on public.offline_start_permits(server_attempt_id) where server_attempt_id is not null;
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
revoke all on function public.register_offline_quest_attempt(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.register_offline_quest_attempt(uuid,uuid,text,uuid) to authenticated;


commit;
