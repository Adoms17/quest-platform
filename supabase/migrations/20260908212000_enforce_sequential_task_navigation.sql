-- Phase 5: prevent API clients from opening future tasks in sequential quests.

create or replace function public.enforce_sequential_task_navigation()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  navigation_mode text;
  attempt_quest_id uuid;
  expected_task_id uuid;
begin
  -- Administrative and migration writes do not represent participant actions.
  if auth.uid() is null then
    return new;
  end if;

  select quest_attempt.quest_id, quest.task_navigation_mode
  into attempt_quest_id, navigation_mode
  from public.quest_attempts quest_attempt
  join public.quests quest on quest.id = quest_attempt.quest_id
  where quest_attempt.id = new.quest_attempt_id;

  if navigation_mode is distinct from 'sequential' then
    return new;
  end if;

  select task.id into expected_task_id
  from public.tasks task
  left join public.task_attempts task_attempt
    on task_attempt.quest_attempt_id = new.quest_attempt_id
    and task_attempt.task_id = task.id
  where task.quest_id = attempt_quest_id
    and not coalesce(task_attempt.completed or task_attempt.failed, false)
  order by task.order_index, task.id
  limit 1;

  if expected_task_id is distinct from new.task_id then
    raise exception using
      errcode = '23514',
      message = 'task is not available in sequential mode';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_sequential_task_navigation_before_insert
  on public.task_attempts;

create trigger enforce_sequential_task_navigation_before_insert
before insert on public.task_attempts
for each row execute function public.enforce_sequential_task_navigation();
