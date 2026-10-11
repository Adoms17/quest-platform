-- Phase 5: define how participants may navigate between quest tasks.

alter table public.quests
  add column task_navigation_mode text not null default 'sequential';

alter table public.quests
  add constraint quests_task_navigation_mode_check
  check (task_navigation_mode in ('sequential', 'free'));

comment on column public.quests.task_navigation_mode is
  'Participant task navigation: sequential unlocks tasks in order, free allows any server-authorized task.';
