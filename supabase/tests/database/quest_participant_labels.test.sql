begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('9e000000-0000-4000-8000-000000000001', 'labels-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('9e000000-0000-4000-8000-000000000002', 'labels-parent@example.test', '{"username":"Parent"}'::jsonb),
  ('9e000000-0000-4000-8000-000000000003', 'labels-outsider@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.quests (id, creator_id, title)
values ('9e100000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'Labels quest');

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('9e200000-0000-4000-8000-000000000001', 'Child label', 'dependent', 'child', '9e000000-0000-4000-8000-000000000002');

insert into public.quest_attempts (
  id, quest_id, user_id, actor_user_id, participant_profile_id, total_tasks
) values (
  '9e300000-0000-4000-8000-000000000001',
  '9e100000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000002',
  '9e000000-0000-4000-8000-000000000002',
  '9e200000-0000-4000-8000-000000000001',
  0
);

select set_config('request.jwt.claim.sub', '9e000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$select participant_profile_id, display_name from public.get_quest_participant_labels('9e100000-0000-4000-8000-000000000001')$$,
  $$values ('9e200000-0000-4000-8000-000000000001'::uuid, 'Child label'::text)$$,
  'quest creator receives only the participant identifier and display label'
);

reset role;
select set_config('request.jwt.claim.sub', '9e000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select * from public.get_quest_participant_labels('9e100000-0000-4000-8000-000000000001')$$,
  '42501', 'quest statistics access denied', 'outsider cannot read participant labels'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.get_quest_participant_labels('9e100000-0000-4000-8000-000000000001')$$,
  '42501', 'quest statistics access denied',
  'anonymous users cannot receive participant labels'
);

select * from finish();
rollback;
