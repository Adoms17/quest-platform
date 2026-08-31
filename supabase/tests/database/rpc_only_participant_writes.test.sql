begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '13000000-0000-4000-8000-000000000001',
    'creator-cutover@example.test',
    '{"username":"creator-cutover"}'::jsonb
  ),
  (
    '13000000-0000-4000-8000-000000000002',
    'participant-cutover@example.test',
    '{"username":"participant-cutover"}'::jsonb
  );

insert into public.quests (
  id, creator_id, title, is_public, verification_options, max_attempts
)
values (
  '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  'RPC-only quest',
  true,
  '["code"]'::jsonb,
  2
);

insert into public.tasks (
  id, quest_id, title, static_code, correct_answer, order_index
)
values (
  '33000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'Secret task',
  'OPEN-CODE',
  'right answer',
  0
);

insert into public.quest_attempts (id, quest_id, user_id, total_tasks)
values (
  '43000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000002',
  1
);

insert into public.task_attempts (id, quest_attempt_id, task_id, opened)
values (
  '53000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000001',
  false
);

select ok(
  not has_table_privilege('anon', 'public.tasks', 'select'),
  'anonymous clients have no direct task table access'
);

select set_config(
  'request.jwt.claim.sub',
  '13000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.tasks
   where id = '33000000-0000-4000-8000-000000000001'),
  0::bigint,
  'participant cannot read task rows containing secrets'
);

select is(
  (select count(*) from public.get_participant_tasks(
    '23000000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'participant can load safe tasks through RPC'
);

select ok(
  (select requires_answer and requires_code and not requires_gps
   from public.get_participant_tasks(
     '23000000-0000-4000-8000-000000000001'
   )),
  'safe RPC exposes requirements without verification values'
);

select throws_ok(
  $$
    insert into public.quest_attempts (quest_id, user_id, total_tasks)
    values (
      '23000000-0000-4000-8000-000000000001',
      '13000000-0000-4000-8000-000000000002',
      1
    )
  $$,
  '42501',
  'permission denied for table quest_attempts',
  'participant cannot directly insert quest attempts'
);

select throws_ok(
  $$
    update public.quest_attempts
    set total_tasks = 99
    where id = '43000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table quest_attempts',
  'participant cannot directly update quest attempts'
);

select throws_ok(
  $$
    insert into public.task_attempts (quest_attempt_id, task_id, opened)
    values (
      '43000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001',
      true
    )
  $$,
  '42501',
  'permission denied for table task_attempts',
  'participant cannot directly insert task attempts'
);

select throws_ok(
  $$
    update public.task_attempts
    set opened = true
    where id = '53000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table task_attempts',
  'participant cannot directly update task attempts'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '13000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select is(
  (select correct_answer from public.tasks
   where id = '33000000-0000-4000-8000-000000000001'),
  'right answer',
  'creator can still read verification data for own task'
);

select lives_ok(
  $$
    update public.tasks
    set title = 'Updated secret task'
    where id = '33000000-0000-4000-8000-000000000001'
  $$,
  'creator can still update tasks in own quest'
);

select * from finish();

rollback;
