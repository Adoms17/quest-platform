begin;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '16000000-0000-4000-8000-000000000001',
    'timing-creator@example.test',
    '{"username":"timing-creator"}'::jsonb
  ),
  (
    '16000000-0000-4000-8000-000000000002',
    'timing-participant@example.test',
    '{"username":"timing-participant"}'::jsonb
  );

insert into public.quests (
  id,
  creator_id,
  title,
  is_public,
  verification_options,
  max_attempts,
  verification_mode,
  offline_progress_policy
)
values
  ('26000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'Trusted timing', true, '["code"]'::jsonb, 2, 'online', 'block'),
  ('26000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'Reported timing', true, '["code"]'::jsonb, 2, 'hybrid', 'allow_pending'),
  ('26000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000001', 'Bounded timing', true, '["code"]'::jsonb, 2, 'hybrid', 'allow_pending'),
  ('26000000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000001', 'Invalid timing', true, '["code"]'::jsonb, 2, 'hybrid', 'allow_pending');

insert into public.tasks (
  id,
  quest_id,
  title,
  static_code,
  correct_answer,
  order_index
)
values
  ('36000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', 'Trusted task', 'OPEN-1', 'right-1', 0),
  ('36000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000002', 'Reported task', 'OPEN-2', 'right-2', 0),
  ('36000000-0000-4000-8000-000000000003', '26000000-0000-4000-8000-000000000003', 'Bounded task', 'OPEN-3', 'right-3', 0),
  ('36000000-0000-4000-8000-000000000004', '26000000-0000-4000-8000-000000000004', 'Invalid task', 'OPEN-4', 'right-4', 0);

select set_config('request.jwt.claim.sub', '16000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select public.start_quest_attempt('26000000-0000-4000-8000-000000000001');
select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000001',
  'open',
  'OPEN-1'
);

reset role;
update public.task_attempts
set created_at = now() - interval '12 seconds'
where task_id = '36000000-0000-4000-8000-000000000001';
set local role authenticated;

select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000002',
  'answer',
  'right-1',
  null,
  null,
  null
);

select ok(
  (select trusted_time_seconds >= 12
      and reported_offline_time_seconds = 0
      and timing_confidence = 'trusted'
   from public.task_attempts
   where task_id = '36000000-0000-4000-8000-000000000001'),
  'online task duration is server-observed and trusted'
);

select ok(
  (select trusted_time_seconds = total_time
      and trusted_time_seconds >= 12
      and reported_offline_time_seconds = 0
      and timing_confidence = 'trusted'
   from public.quest_attempts
   where quest_id = '26000000-0000-4000-8000-000000000001'),
  'online quest aggregate keeps trusted time compatible with total_time'
);

select public.start_quest_attempt('26000000-0000-4000-8000-000000000002');
select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000002' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000002',
  '56000000-0000-4000-8000-000000000003',
  'open',
  'OPEN-2'
);
select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000002' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000002',
  '56000000-0000-4000-8000-000000000004',
  'answer',
  'right-2',
  null,
  null,
  30
);

select ok(
  (select reported_offline_time_seconds = 30
      and timing_confidence = 'reported'
   from public.task_attempts
   where task_id = '36000000-0000-4000-8000-000000000002'),
  'unanchored offline duration is stored as reported task time'
);

select ok(
  (select reported_offline_time_seconds = 30
      and timing_confidence = 'reported'
      and total_time = trusted_time_seconds
   from public.quest_attempts
   where quest_id = '26000000-0000-4000-8000-000000000002'),
  'reported offline time is not mixed into trusted quest total'
);

select public.start_quest_attempt('26000000-0000-4000-8000-000000000003');
reset role;
update public.quest_attempts
set started_at = now() - interval '120 seconds'
where quest_id = '26000000-0000-4000-8000-000000000003';
set local role authenticated;

select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000003' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000003',
  '56000000-0000-4000-8000-000000000005',
  'open',
  'OPEN-3'
);
select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000003' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000003',
  '56000000-0000-4000-8000-000000000006',
  'answer',
  'right-3',
  null,
  null,
  45
);

select ok(
  (select reported_offline_time_seconds = 45
      and timing_confidence = 'bounded'
   from public.task_attempts
   where task_id = '36000000-0000-4000-8000-000000000003'),
  'offline task duration inside a server-known bound is marked bounded'
);

select ok(
  (select reported_offline_time_seconds = 45
      and timing_confidence = 'bounded'
   from public.quest_attempts
   where quest_id = '26000000-0000-4000-8000-000000000003'),
  'quest timing confidence aggregates bounded task timing'
);

select public.start_quest_attempt('26000000-0000-4000-8000-000000000004');
select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000004' and user_id = auth.uid()),
  '36000000-0000-4000-8000-000000000004',
  '56000000-0000-4000-8000-000000000007',
  'open',
  'OPEN-4'
);

select throws_ok(
  format(
    'select public.submit_task_event(%L, %L, %L, %L, %L, null, null, 86401)',
    (select id from public.quest_attempts where quest_id = '26000000-0000-4000-8000-000000000004' and user_id = auth.uid()),
    '36000000-0000-4000-8000-000000000004',
    '56000000-0000-4000-8000-000000000008',
    'answer',
    'right-4'
  ),
  '22023',
  'reported offline time exceeds 24 hour limit',
  'implausible client-reported duration is rejected'
);

reset role;

select is(
  (select count(*)
   from public.task_submission_events
   where client_event_id = '56000000-0000-4000-8000-000000000008'),
  0::bigint,
  'rejected timing event is rolled back completely'
);

select * from finish();
rollback;
