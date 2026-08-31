-- Allow the offline synchronizer to reconcile transport-ambiguous events
-- before it creates or rebinds a quest attempt.

create or replace function public.get_task_event_receipts(
  p_client_event_ids uuid[]
)
returns table (
  client_event_id uuid,
  quest_attempt_id uuid,
  server_state jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    event.client_event_id,
    event.quest_attempt_id,
    event.server_state
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
