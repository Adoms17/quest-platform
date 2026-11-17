begin;
alter table public.offline_attempt_registrations add column permit_id uuid
  references public.offline_start_permits(id) on delete restrict;
create unique index offline_registration_one_permit on public.offline_attempt_registrations(permit_id) where permit_id is not null;

create function public.register_permitted_offline_attempt(
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
revoke all on function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) to service_role;
comment on function public.register_permitted_offline_attempt(uuid,uuid,text,uuid) is
 'Закрытая атомарная регистрация права + actor/local ID. Другая локальная история не объединяется с погашенным правом. Старые RPC не заменены; клиентский rollout требует отдельной совместимости.';
commit;
