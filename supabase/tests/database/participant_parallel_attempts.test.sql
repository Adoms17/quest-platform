begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('9c000000-0000-4000-8000-000000000001', 'parallel-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('9c000000-0000-4000-8000-000000000002', 'parallel-parent@example.test', '{"username":"Parent"}'::jsonb);

insert into public.quests (id, creator_id, title, is_public)
values ('9c100000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'Parallel quest', true);

insert into public.tasks (id, quest_id, title)
values ('9c300000-0000-4000-8000-000000000001', '9c100000-0000-4000-8000-000000000001', 'Parallel task');

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values
  ('9c200000-0000-4000-8000-000000000001', 'First child', 'dependent', 'child', '9c000000-0000-4000-8000-000000000002'),
  ('9c200000-0000-4000-8000-000000000002', 'Second child', 'dependent', 'child', '9c000000-0000-4000-8000-000000000002');

insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values
  ('9c000000-0000-4000-8000-000000000002', '9c200000-0000-4000-8000-000000000001'),
  ('9c000000-0000-4000-8000-000000000002', '9c200000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select set_config('app.first_child_attempt', (
  select id::text
  from public.start_quest_attempt_for_participant(
    '9c100000-0000-4000-8000-000000000001',
    '9c200000-0000-4000-8000-000000000001'
  )
), true);

select set_config('app.second_child_attempt', (
  select id::text
  from public.start_quest_attempt_for_participant(
    '9c100000-0000-4000-8000-000000000001',
    '9c200000-0000-4000-8000-000000000002'
  )
), true);

select isnt(
  current_setting('app.first_child_attempt')::uuid,
  current_setting('app.second_child_attempt')::uuid,
  'one adult receives separate active attempts for two children'
);

select is(
  (select count(*) from public.quest_attempts
   where quest_id = '9c100000-0000-4000-8000-000000000001'
     and user_id = '9c000000-0000-4000-8000-000000000002'
     and finished_at is null),
  2::bigint,
  'both participant attempts remain active for the same actor'
);

select results_eq(
  $$select participant_profile_id from public.quest_attempts
    where quest_id = '9c100000-0000-4000-8000-000000000001'
    order by participant_profile_id$$,
  $$values
    ('9c200000-0000-4000-8000-000000000001'::uuid),
    ('9c200000-0000-4000-8000-000000000002'::uuid)$$,
  'active attempts are uniquely scoped to participant profiles'
);

select * from finish();
rollback;
