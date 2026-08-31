begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('17000000-0000-4000-8000-000000000001', 'receipt-creator@example.test', '{"username":"receipt-creator"}'::jsonb),
  ('17000000-0000-4000-8000-000000000002', 'receipt-owner@example.test', '{"username":"receipt-owner"}'::jsonb),
  ('17000000-0000-4000-8000-000000000003', 'receipt-outsider@example.test', '{"username":"receipt-outsider"}'::jsonb);

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
values (
  '27000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  'Receipt quest',
  true,
  '["code"]'::jsonb,
  2,
  'secure_online',
  'allow_pending'
);

insert into public.tasks (
  id,
  quest_id,
  title,
  static_code,
  correct_answer,
  order_index
)
values (
  '37000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  'Receipt task',
  'OPEN',
  'right',
  0
);

select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select public.start_quest_attempt('27000000-0000-4000-8000-000000000001');

select public.submit_task_event(
  (select id from public.quest_attempts where quest_id = '27000000-0000-4000-8000-000000000001' and user_id = auth.uid()),
  '37000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000001',
  'open',
  'OPEN'
);

select is(
  (select count(*) from public.get_task_event_receipts(
    array['57000000-0000-4000-8000-000000000001']::uuid[]
  )),
  1::bigint,
  'participant can reconcile their acknowledged event'
);

select ok(
  (select
     receipt.quest_attempt_id is not null
     and (receipt.server_state->>'opened')::boolean
     and (receipt.server_state->>'accepted')::boolean
   from public.get_task_event_receipts(
     array['57000000-0000-4000-8000-000000000001']::uuid[]
   ) receipt),
  'receipt contains attempt affinity and the original safe server state'
);

reset role;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select is(
  (select count(*) from public.get_task_event_receipts(
    array['57000000-0000-4000-8000-000000000001']::uuid[]
  )),
  0::bigint,
  'another participant cannot read event receipts'
);

reset role;
select * from finish();
rollback;
