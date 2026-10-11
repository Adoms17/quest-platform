-- Prevent a task result from being attached to an attempt for another quest.

create or replace function public.enforce_task_attempt_quest_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  task_quest_id uuid;
  attempt_quest_id uuid;
begin
  select tasks.quest_id
  into task_quest_id
  from public.tasks
  where tasks.id = new.task_id;

  select quest_attempts.quest_id
  into attempt_quest_id
  from public.quest_attempts
  where quest_attempts.id = new.quest_attempt_id;

  if task_quest_id is not null
     and attempt_quest_id is not null
     and task_quest_id is distinct from attempt_quest_id
  then
    raise exception using
      errcode = '23514',
      message = 'task attempt quest mismatch';
  end if;

  return new;
end;
$function$;

revoke execute on function public.enforce_task_attempt_quest_match()
  from public, anon, authenticated;

create trigger enforce_task_attempt_quest_match
before insert or update of quest_attempt_id, task_id
on public.task_attempts
for each row execute function public.enforce_task_attempt_quest_match();
