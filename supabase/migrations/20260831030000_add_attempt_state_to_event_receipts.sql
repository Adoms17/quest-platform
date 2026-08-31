-- Include current server attempt state so the client can distinguish an
-- active partial sync from an attempt that completed after a lost response.

drop function public.get_task_event_receipts(uuid[]);

create function public.get_task_event_receipts(
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
set search_path = ''
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
  join public.quest_attempts attempt
    on attempt.id = event.quest_attempt_id
  where attempt.user_id = auth.uid()
    and event.client_event_id = any(
      coalesce(p_client_event_ids, array[]::uuid[])
    );
$$;

revoke execute on function public.get_task_event_receipts(uuid[])
  from public, anon;

grant execute on function public.get_task_event_receipts(uuid[])
  to authenticated, service_role;
