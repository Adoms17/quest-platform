begin;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('9d000000-0000-4000-8000-000000000001', 'history-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('9d000000-0000-4000-8000-000000000002', 'history-parent@example.test', '{"username":"Parent"}'::jsonb),
  ('9d000000-0000-4000-8000-000000000003', 'history-outsider@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.quests (id, creator_id, title)
values ('9d100000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'History quest');

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('9d200000-0000-4000-8000-000000000001', 'History child', 'dependent', 'child', '9d000000-0000-4000-8000-000000000002');

insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values ('9d000000-0000-4000-8000-000000000002', '9d200000-0000-4000-8000-000000000001');

insert into public.quest_attempts (
  id, quest_id, user_id, actor_user_id, participant_profile_id,
  total_tasks, completed_tasks, failed_tasks, total_attempts, total_time,
  percent_success, finished_at
) values (
  '9d300000-0000-4000-8000-000000000001',
  '9d100000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000002',
  '9d000000-0000-4000-8000-000000000002',
  '9d200000-0000-4000-8000-000000000001',
  2, 1, 1, 2, 60, 50, now()
);

select set_config('request.jwt.claim.sub', '9d000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.get_participant_quest_history('9d200000-0000-4000-8000-000000000001')),
  1::bigint,
  'an active supervisor can read dependent participant history'
);
select results_eq(
  $$select quest_title, completed_tasks, failed_tasks from public.get_participant_quest_history('9d200000-0000-4000-8000-000000000001')$$,
  $$values ('History quest'::text, 1, 1)$$,
  'history returns safe quest and aggregate result fields'
);

reset role;
select set_config('request.jwt.claim.sub', '9d000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select * from public.get_participant_quest_history('9d200000-0000-4000-8000-000000000001')$$,
  '42501', 'participant history access denied',
  'an unrelated account cannot read dependent participant history'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.get_participant_quest_history('9d200000-0000-4000-8000-000000000001')$$,
  '42501', 'participant history access denied',
  'anonymous users cannot read participant history'
);

select * from finish();
rollback;
