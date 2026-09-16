create table public.offline_attempt_registrations (
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  local_attempt_id text not null check (length(local_attempt_id) between 1 and 200),
  quest_id uuid not null,
  participant_profile_id uuid not null,
  server_attempt_id uuid not null,
  registered_at timestamptz not null default statement_timestamp(),
  primary key (actor_user_id, local_attempt_id)
);
alter table public.offline_attempt_registrations enable row level security;
revoke all on public.offline_attempt_registrations from public, anon, authenticated;
comment on table public.offline_attempt_registrations is
  'Сопоставление локального ID в области аккаунта. Сохраняется при удалении попытки/квеста, чтобы retry не создавал новое прохождение. Клиентский доступ только через RPC.';

create function public.register_offline_quest_attempt(p_quest_id uuid, p_participant_profile_id uuid, p_local_attempt_id text)
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
  select * into registration from public.offline_attempt_registrations
    where actor_user_id=actor and local_attempt_id=p_local_attempt_id;
  if found then
    if registration.quest_id<>p_quest_id or registration.participant_profile_id<>p_participant_profile_id then
      raise exception 'offline attempt scope mismatch' using errcode='42501';
    end if;
    resolved_id := registration.server_attempt_id;
  else
    select id into resolved_id from public.start_quest_attempt_for_participant(p_quest_id,p_participant_profile_id);
    insert into public.offline_attempt_registrations(actor_user_id,local_attempt_id,quest_id,participant_profile_id,server_attempt_id)
      values(actor,p_local_attempt_id,p_quest_id,p_participant_profile_id,resolved_id);
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
revoke all on function public.register_offline_quest_attempt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.register_offline_quest_attempt(uuid,uuid,text) to authenticated;
