-- Align the low-level event guard and receipt lookup with actor/participant access.

create or replace function public.enforce_task_event_quest_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_quest_id uuid;
  target_participant_profile_id uuid;
begin
  select attempt.quest_id, attempt.participant_profile_id
  into target_quest_id, target_participant_profile_id
  from public.quest_attempts attempt
  where attempt.id = new.quest_attempt_id
    and attempt.user_id = auth.uid();

  if target_quest_id is null or not public.can_actor_access_quest(
    target_quest_id,
    target_participant_profile_id
  ) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;
  return new;
end;
$$;

create or replace function public.get_task_event_receipts(
  p_client_event_ids uuid[]
)
returns table (
  client_event_id uuid,
  quest_attempt_id uuid,
  server_state jsonb,
  quest_attempt_state jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    event.client_event_id,
    event.quest_attempt_id,
    event.server_state,
    jsonb_build_object(
      'id', attempt.id,
      'finished_at', attempt.finished_at,
      'completed_tasks', attempt.completed_tasks,
      'failed_tasks', attempt.failed_tasks,
      'total_attempts', attempt.total_attempts,
      'total_time', attempt.total_time,
      'percent_success', attempt.percent_success
    )
  from public.task_submission_events event
  join public.quest_attempts attempt on attempt.id = event.quest_attempt_id
  where attempt.user_id = auth.uid()
    and public.can_actor_access_quest(attempt.quest_id, attempt.participant_profile_id)
    and event.client_event_id = any(coalesce(p_client_event_ids, array[]::uuid[]));
$$;

revoke all on function public.get_task_event_receipts(uuid[]) from public, anon;
grant execute on function public.get_task_event_receipts(uuid[]) to authenticated, service_role;
