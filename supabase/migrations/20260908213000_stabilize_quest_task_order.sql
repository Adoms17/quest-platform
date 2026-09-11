-- Normalize legacy duplicate positions and make task ordering deterministic.

with ranked_tasks as (
  select
    task.ctid,
    row_number() over (
      partition by task.quest_id
      order by task.order_index, task.ctid
    ) - 1 as normalized_order_index
  from public.tasks task
)
update public.tasks task
set order_index = ranked.normalized_order_index
from ranked_tasks ranked
where task.ctid = ranked.ctid
  and task.order_index is distinct from ranked.normalized_order_index;

alter table public.tasks alter column order_index drop default;

create or replace function public.assign_quest_task_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.order_index is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.quest_id::text, 0)
  );

  select coalesce(max(task.order_index) + 1, 0)
  into new.order_index
  from public.tasks task
  where task.quest_id = new.quest_id;

  return new;
end;
$$;

drop trigger if exists assign_quest_task_order_before_insert on public.tasks;
create trigger assign_quest_task_order_before_insert
before insert on public.tasks
for each row execute function public.assign_quest_task_order();

alter table public.tasks alter column order_index set not null;

create or replace function public.reorder_quest_tasks(
  p_quest_id uuid,
  p_task_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quest_task_count integer;
  requested_task_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not public.has_quest_permission(p_quest_id, 'quests.update') then
    raise exception using errcode = '42501', message = 'quest update access denied';
  end if;

  select count(*)::integer into quest_task_count
  from public.tasks task
  where task.quest_id = p_quest_id;

  select count(distinct requested.task_id)::integer into requested_task_count
  from unnest(coalesce(p_task_ids, array[]::uuid[])) requested(task_id)
  join public.tasks task
    on task.id = requested.task_id
    and task.quest_id = p_quest_id;

  if coalesce(array_length(p_task_ids, 1), 0) <> quest_task_count
    or requested_task_count <> quest_task_count then
    raise exception using errcode = '22023', message = 'task order must contain every quest task exactly once';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_quest_id::text, 0)
  );

  update public.tasks task
  set order_index = requested.position - 1
  from unnest(p_task_ids) with ordinality requested(task_id, position)
  where task.id = requested.task_id
    and task.quest_id = p_quest_id;
end;
$$;

revoke all on function public.reorder_quest_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_quest_tasks(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_quest_tasks(uuid, uuid[]) to service_role;
