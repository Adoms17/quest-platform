begin;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('12000000-0000-4000-8000-000000000001', 'creator-rpc@example.test', '{"username":"creator-rpc"}'::jsonb),
  ('12000000-0000-4000-8000-000000000002', 'participant-rpc@example.test', '{"username":"participant-rpc"}'::jsonb),
  ('12000000-0000-4000-8000-000000000003', 'outsider-rpc@example.test', '{"username":"outsider-rpc"}'::jsonb);

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
  (
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'RPC quest',
    true,
    '["code"]'::jsonb,
    2,
    'secure_online',
    'allow_pending'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000001',
    'Other quest',
    true,
    '["code"]'::jsonb,
    2,
    'online',
    'block'
  );

insert into public.tasks (
  id,
  quest_id,
  title,
  static_code,
  correct_answer,
  order_index
)
values
  (
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'RPC task',
    'OPEN',
    'right',
    0
  ),
  (
    '32000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'Other task',
    'OTHER',
    'other-answer',
    0
  );

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (select count(*) from public.get_participant_tasks('22000000-0000-4000-8000-000000000001')),
  1::bigint,
  'participant-safe task RPC returns tasks for an accessible quest'
);

select ok(
  (select requires_answer and requires_code and not requires_gps
   from public.get_participant_tasks('22000000-0000-4000-8000-000000000001')),
  'participant-safe task RPC returns verification requirements without secrets'
);

select is(
  (select count(*) from public.start_quest_attempt('22000000-0000-4000-8000-000000000001')),
  1::bigint,
  'participant can start an accessible quest attempt'
);

select is(
  (select id from public.start_quest_attempt('22000000-0000-4000-8000-000000000001')),
  (select id
   from public.quest_attempts
   where quest_id = '22000000-0000-4000-8000-000000000001'
     and user_id = '12000000-0000-4000-8000-000000000002'
     and finished_at is null),
  'starting the same quest reuses the active server attempt'
);

select is(
  (public.submit_task_event(
    (select id from public.quest_attempts where quest_id = '22000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
    '32000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    'open',
    'WRONG'
  )->>'opened')::boolean,
  false,
  'wrong access code does not open the task'
);

select is(
  (public.submit_task_event(
    (select id from public.quest_attempts where quest_id = '22000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
    '32000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000002',
    'open',
    'open'
  )->>'opened')::boolean,
  true,
  'correct access code opens the task on the server'
);

select throws_ok(
  format(
    'select public.submit_task_event(%L, %L, %L, %L, %L)',
    (select id from public.quest_attempts where quest_id = '22000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
    '32000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000003',
    'open',
    'OTHER'
  ),
  '23514',
  'task attempt quest mismatch',
  'RPC rejects a task from another quest'
);

select ok(
  (select state->>'attempts_used' = '1' and state->>'terminal' = 'false'
   from (
     select public.submit_task_event(
       (select id from public.quest_attempts where quest_id = '22000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
       '32000000-0000-4000-8000-000000000001',
       '52000000-0000-4000-8000-000000000004',
       'answer',
       'wrong'
     ) as state
   ) as submitted),
  'first wrong answer consumes exactly one server attempt'
);

select is(
  (public.submit_task_event(
    (select id from public.quest_attempts where quest_id = '22000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
    '32000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000004',
    'answer',
    'wrong'
  )->>'attempts_used')::integer,
  1,
  'replaying client_event_id returns the original server state'
);

reset role;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select throws_ok(
  format(
    'select public.submit_task_event(%L, %L, %L, %L, %L)',
    (select id
     from public.quest_attempts
     where quest_id = '22000000-0000-4000-8000-000000000001'
       and user_id = '12000000-0000-4000-8000-000000000002'),
    '32000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000005',
    'answer',
    'right'
  ),
  '42501',
  'quest attempt access denied',
  'RPC rejects another user quest attempt'
);

reset role;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (public.submit_task_event(
    (select id from public.quest_attempts where quest_id = '22000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
    '32000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000006',
    'answer',
    'still-wrong'
  )->>'failed')::boolean,
  true,
  'server marks the task failed when the strict limit is exhausted'
);

select ok(
  (select total_attempts = 2
          and failed_tasks = 1
          and completed_tasks = 0
          and finished_at is not null
   from public.quest_attempts
   where quest_id = '22000000-0000-4000-8000-000000000001'
     and user_id = auth.uid()),
  'server recomputes trusted quest aggregates and completion state'
);

reset role;

select is(
  (select count(*)
   from public.task_submission_events
   where quest_attempt_id = (
     select id
     from public.quest_attempts
     where quest_id = '22000000-0000-4000-8000-000000000001'
       and user_id = '12000000-0000-4000-8000-000000000002'
   )),
  4::bigint,
  'duplicate and rejected RPC calls do not create extra events'
);

select throws_ok(
  $$
    insert into public.quests (creator_id, title, verification_mode)
    values (
      '12000000-0000-4000-8000-000000000001',
      'Invalid verification mode',
      'client_only'
    )
  $$,
  '23514',
  null,
  'unsupported verification modes are rejected'
);

select throws_ok(
  $$
    insert into public.quests (creator_id, title, offline_progress_policy)
    values (
      '12000000-0000-4000-8000-000000000001',
      'Invalid offline policy',
      'skip_checks'
    )
  $$,
  '23514',
  null,
  'unsupported offline progress policies are rejected'
);

select * from finish();

rollback;
