-- Recheck participant authorization for every task event. Owning an attempt is
-- not sufficient after supervision or quest access has been revoked.

alter function public.submit_task_event(
  uuid, uuid, uuid, text, text, double precision, double precision, integer
) rename to submit_task_event_internal;

revoke all on function public.submit_task_event_internal(
  uuid, uuid, uuid, text, text, double precision, double precision, integer
) from public, anon, authenticated, service_role;

create function public.submit_task_event(
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
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  target_quest_id uuid;
  target_participant_profile_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select attempt.quest_id, attempt.participant_profile_id
  into target_quest_id, target_participant_profile_id
  from public.quest_attempts attempt
  where attempt.id = p_quest_attempt_id
    and attempt.user_id = current_user_id;

  if not found or not public.can_actor_access_quest(
    target_quest_id,
    target_participant_profile_id
  ) then
    raise exception using errcode = '42501', message = 'quest attempt access denied';
  end if;

  return public.submit_task_event_internal(
    p_quest_attempt_id,
    p_task_id,
    p_client_event_id,
    p_event_type,
    p_submitted_value,
    p_latitude,
    p_longitude,
    p_client_elapsed_seconds
  );
end;
$$;

revoke all on function public.submit_task_event(
  uuid, uuid, uuid, text, text, double precision, double precision, integer
) from public, anon;
grant execute on function public.submit_task_event(
  uuid, uuid, uuid, text, text, double precision, double precision, integer
) to authenticated, service_role;
