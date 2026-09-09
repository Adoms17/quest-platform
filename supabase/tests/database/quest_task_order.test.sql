begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('1f000000-0000-4000-8000-000000000001', 'order-owner@example.test', '{}'::jsonb),
  ('1f000000-0000-4000-8000-000000000002', 'order-outsider@example.test', '{}'::jsonb);

insert into public.quests (id, creator_id, title)
values ('2f000000-0000-4000-8000-000000000001', '1f000000-0000-4000-8000-000000000001', 'Ordered quest');

insert into public.tasks (id, quest_id, title)
values
  ('3f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001', 'First task'),
  ('3f000000-0000-4000-8000-000000000002', '2f000000-0000-4000-8000-000000000001', 'Second task'),
  ('3f000000-0000-4000-8000-000000000003', '2f000000-0000-4000-8000-000000000001', 'Third task');

select is(
  (select string_agg(task.order_index::text, ',' order by task.order_index) from public.tasks task where task.quest_id = '2f000000-0000-4000-8000-000000000001'),
  '0,1,2',
  'new tasks receive consecutive positions'
);

select set_config('request.jwt.claim.sub', '1f000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.reorder_quest_tasks(
    '2f000000-0000-4000-8000-000000000001',
    array[
      '3f000000-0000-4000-8000-000000000003',
      '3f000000-0000-4000-8000-000000000001',
      '3f000000-0000-4000-8000-000000000002'
    ]::uuid[]
  )$$,
  'owner can atomically reorder every quest task'
);

select is(
  (select string_agg(task.title, ',' order by task.order_index) from public.tasks task where task.quest_id = '2f000000-0000-4000-8000-000000000001'),
  'Third task,First task,Second task',
  'reordered positions are persisted deterministically'
);

select throws_ok(
  $$select public.reorder_quest_tasks(
    '2f000000-0000-4000-8000-000000000001',
    array['3f000000-0000-4000-8000-000000000001']::uuid[]
  )$$,
  '22023',
  'task order must contain every quest task exactly once',
  'partial task orders are rejected'
);

select set_config('request.jwt.claim.sub', '1f000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.reorder_quest_tasks(
    '2f000000-0000-4000-8000-000000000001',
    array[
      '3f000000-0000-4000-8000-000000000001',
      '3f000000-0000-4000-8000-000000000002',
      '3f000000-0000-4000-8000-000000000003'
    ]::uuid[]
  )$$,
  '42501',
  'quest update access denied',
  'outsider cannot reorder quest tasks'
);

select * from finish();
rollback;
