begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'creator@example.test', '{"username":"creator"}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'participant@example.test', '{"username":"participant"}'::jsonb);

insert into public.quests (id, creator_id, title)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Quest A'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Quest B');

insert into public.tasks (id, quest_id, title)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Task A'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Task B');

insert into public.quest_attempts (id, quest_id, user_id, total_tasks)
values (
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  1
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.task_attempts'::regclass
      and tgname = 'enforce_task_attempt_quest_match'
      and not tgisinternal
  ),
  'task_attempts has a quest consistency trigger'
);

select lives_ok(
  $$
    insert into public.task_attempts (quest_attempt_id, task_id)
    values (
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    )
  $$,
  'a task from the attempted quest is accepted'
);

select throws_ok(
  $$
    insert into public.task_attempts (quest_attempt_id, task_id)
    values (
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'task attempt quest mismatch',
  'a task from another quest is rejected'
);

select * from finish();

rollback;
