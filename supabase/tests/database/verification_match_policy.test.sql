begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('13000000-0000-4000-8000-000000000001', 'creator-policy@example.test', '{}'::jsonb),
  ('13000000-0000-4000-8000-000000000002', 'participant-policy@example.test', '{}'::jsonb);

insert into public.quests (
  id, creator_id, title, is_public, location_options,
  verification_options, verification_match_policy
)
values
  ('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'ALL policy', true, '["gps"]', '["gps", "code"]', 'all'),
  ('23000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', 'ANY policy', true, '["gps"]', '["gps", "code"]', 'any');

insert into public.tasks (id, quest_id, title, gps_point, static_code, order_index)
values
  ('33000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', 'ALL task', public.st_setsrid(public.st_makepoint(33.5, 44.6), 4326), 'OPEN', 0),
  ('33000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000002', 'ANY task', public.st_setsrid(public.st_makepoint(33.5, 44.6), 4326), 'OPEN', 0);

select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select public.start_quest_attempt('23000000-0000-4000-8000-000000000001');
select public.start_quest_attempt('23000000-0000-4000-8000-000000000002');

select is(
  (public.submit_task_event((select id from public.quest_attempts where quest_id = '23000000-0000-4000-8000-000000000001'), '33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', 'open', 'OPEN')->>'opened')::boolean,
  false,
  'ALL rejects code without GPS'
);

select is(
  (public.submit_task_event((select id from public.quest_attempts where quest_id = '23000000-0000-4000-8000-000000000002'), '33000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000002', 'open', 'OPEN')->>'opened')::boolean,
  true,
  'ANY accepts a valid code without GPS'
);

select is(
  (public.submit_task_event((select id from public.quest_attempts where quest_id = '23000000-0000-4000-8000-000000000002'), '33000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000003', 'open', null, 44.6, 33.5)->>'opened')::boolean,
  true,
  'ANY accepts valid GPS without a code'
);

reset role;

select throws_ok(
  $$insert into public.quests (creator_id, title, verification_match_policy) values ('13000000-0000-4000-8000-000000000001', 'Invalid policy', 'some')$$,
  '23514',
  null,
  'unsupported match policy is rejected'
);

select is(
  (select verification_match_policy from public.quests where id = '23000000-0000-4000-8000-000000000001'),
  'all',
  'ALL policy is stored explicitly'
);

select * from finish();
rollback;
