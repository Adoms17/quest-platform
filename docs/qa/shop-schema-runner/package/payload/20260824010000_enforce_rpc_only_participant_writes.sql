-- Participants must use server-owned RPCs for task verification and
-- attempt mutations. Creators retain task management through RLS.

drop policy if exists "Anyone can view tasks"
  on public.tasks;

drop policy if exists "Users can insert own quest_attempts"
  on public.quest_attempts;

drop policy if exists "Users can update own quest_attempts"
  on public.quest_attempts;

drop policy if exists "Users can insert own task_attempts"
  on public.task_attempts;

drop policy if exists "Users can update own task_attempts"
  on public.task_attempts;

revoke all on table public.tasks from anon;

grant select, insert, update, delete
  on table public.tasks
  to authenticated;

revoke insert, update
  on table public.quest_attempts
  from anon, authenticated;

revoke insert, update
  on table public.task_attempts
  from anon, authenticated;

grant select, delete
  on table public.quest_attempts
  to authenticated;

grant select, delete
  on table public.task_attempts
  to authenticated;
