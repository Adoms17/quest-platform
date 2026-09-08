begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('9f000000-0000-4000-8000-000000000001', 'entry-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('9f000000-0000-4000-8000-000000000002', 'entry-parent@example.test', '{"username":"Parent"}'::jsonb),
  ('9f000000-0000-4000-8000-000000000003', 'entry-outsider@example.test', '{"username":"Outsider"}'::jsonb),
  ('9f000000-0000-4000-8000-000000000004', 'entry-second-parent@example.test', '{"username":"Second parent"}'::jsonb);
insert into public.quests (id, creator_id, title, is_public, max_quest_attempts)
values ('9f100000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'Child quest', false, 1);
insert into public.tasks (id, quest_id, title, correct_answer)
values ('9f300000-0000-4000-8000-000000000001', '9f100000-0000-4000-8000-000000000001', 'Safe task', 'secret');
insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('9f200000-0000-4000-8000-000000000001', 'Child', 'dependent', 'child', '9f000000-0000-4000-8000-000000000002');
insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values
  ('9f000000-0000-4000-8000-000000000002', '9f200000-0000-4000-8000-000000000001'),
  ('9f000000-0000-4000-8000-000000000004', '9f200000-0000-4000-8000-000000000001');
insert into public.quest_access_grants (quest_id, user_id, participant_profile_id)
values ('9f100000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000002', '9f200000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (public.get_participant_quest_for_profile('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')->>'title'),
  'Child quest', 'profile-scoped RPC returns quest metadata'
);
select is(
  (select count(*) from public.get_participant_tasks_for_profile('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')),
  1::bigint, 'profile-scoped RPC returns participant tasks'
);
select is(
  (select answer_verifier is null from public.get_participant_tasks_for_profile('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')),
  true, 'server mode does not disclose the correct answer verifier'
);
select set_config('app.test_profile_attempt_id', (
  select id::text from public.start_quest_attempt_for_participant('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')
), true);
select is(
  (select participant_profile_id from public.quest_attempts where id = current_setting('app.test_profile_attempt_id')::uuid),
  '9f200000-0000-4000-8000-000000000001'::uuid, 'attempt belongs to selected participant'
);
select is(
  (select actor_user_id from public.quest_attempts where id = current_setting('app.test_profile_attempt_id')::uuid),
  '9f000000-0000-4000-8000-000000000002'::uuid, 'attempt records the acting adult separately'
);
select is(
  (select id from public.start_quest_attempt_for_participant('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')),
  current_setting('app.test_profile_attempt_id')::uuid, 'starting again resumes the participant active attempt'
);

reset role;
select set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(
  (select id from public.start_quest_attempt_for_participant('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')),
  current_setting('app.test_profile_attempt_id')::uuid, 'another supervisor resumes the same participant attempt'
);
select results_eq(
  $$select user_id, actor_user_id from public.quest_attempts where id = current_setting('app.test_profile_attempt_id')::uuid$$,
  $$values ('9f000000-0000-4000-8000-000000000004'::uuid, '9f000000-0000-4000-8000-000000000002'::uuid)$$,
  'active control transfers while the original actor remains recorded'
);

reset role;
select set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.get_participant_quest_for_profile('9f100000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001')$$,
  '42501', 'quest access denied', 'outsider cannot load a quest as another participant'
);

select * from finish();
rollback;
