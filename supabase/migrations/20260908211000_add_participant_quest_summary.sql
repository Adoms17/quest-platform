-- Phase 5: expose a privacy-preserving task summary for participant navigation.

create or replace function public.get_participant_quest_summary(
  p_quest_id uuid,
  p_participant_profile_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  quest_record public.quests%rowtype;
  attempt_record public.quest_attempts%rowtype;
  task_count integer;
  visible_task_list jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.can_actor_access_quest(p_quest_id, p_participant_profile_id) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  select * into quest_record
  from public.quests quest
  where quest.id = p_quest_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'quest not found';
  end if;

  select * into attempt_record
  from public.quest_attempts attempt
  where attempt.quest_id = p_quest_id
    and attempt.participant_profile_id = p_participant_profile_id
    and attempt.finished_at is null
  order by attempt.started_at desc, attempt.id
  limit 1;

  select count(*)::integer into task_count
  from public.tasks task
  where task.quest_id = p_quest_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', visible.task_id,
        'order_index', visible.order_index,
        'title', visible.title,
        'status', visible.task_status,
        'has_coordinates', visible.has_coordinates
      ) order by visible.order_index, visible.task_id
    ),
    '[]'::jsonb
  ) into visible_task_list
  from (
    select
      task.id as task_id,
      task.order_index,
      task.title,
      task.gps_point is not null as has_coordinates,
      case
        when task_attempt.completed then 'completed'
        when task_attempt.failed then 'failed'
        when task_attempt.opened then 'in_progress'
        else 'available'
      end as task_status
    from public.tasks task
    left join public.task_attempts task_attempt
      on task_attempt.quest_attempt_id = attempt_record.id
      and task_attempt.task_id = task.id
    where task.quest_id = p_quest_id
      and (
        quest_record.task_navigation_mode = 'free'
        or coalesce(task_attempt.completed or task_attempt.failed, false)
        or task.id = (
          select next_task.id
          from public.tasks next_task
          left join public.task_attempts next_attempt
            on next_attempt.quest_attempt_id = attempt_record.id
            and next_attempt.task_id = next_task.id
          where next_task.quest_id = p_quest_id
            and not coalesce(next_attempt.completed or next_attempt.failed, false)
          order by next_task.order_index, next_task.id
          limit 1
        )
      )
  ) visible;

  return jsonb_build_object(
    'quest_id', quest_record.id,
    'navigation_mode', quest_record.task_navigation_mode,
    'total_tasks', task_count,
    'active_attempt_id', attempt_record.id,
    'completed_tasks', coalesce(attempt_record.completed_tasks, 0),
    'failed_tasks', coalesce(attempt_record.failed_tasks, 0),
    'tasks', visible_task_list
  );
end;
$$;

revoke all on function public.get_participant_quest_summary(uuid, uuid) from public, anon;
grant execute on function public.get_participant_quest_summary(uuid, uuid) to authenticated;
grant execute on function public.get_participant_quest_summary(uuid, uuid) to service_role;
