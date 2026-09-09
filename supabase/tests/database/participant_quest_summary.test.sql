begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('1e000000-0000-4000-8000-000000000001', 'summary-owner@example.test', '{}'::jsonb),
  ('1e000000-0000-4000-8000-000000000002', 'summary-player@example.test', '{}'::jsonb),
  ('1e000000-0000-4000-8000-000000000003', 'summary-outsider@example.test', '{}'::jsonb);

insert into public.quests (
  id, creator_id, organization_id, title, is_public, task_navigation_mode
)
select seed.id, '1e000000-0000-4000-8000-000000000001', organization.id,
  seed.title, seed.is_public, seed.navigation_mode
from (
  values
    ('2e000000-0000-4000-8000-000000000001'::uuid, 'Sequential summary', true, 'sequential'),
    ('2e000000-0000-4000-8000-000000000002'::uuid, 'Free summary', true, 'free'),
    ('2e000000-0000-4000-8000-000000000003'::uuid, 'Private summary', false, 'sequential')
) seed(id, title, is_public, navigation_mode)
join public.organizations organization
  on organization.personal_owner_id = '1e000000-0000-4000-8000-000000000001';

insert into public.tasks (
  id, quest_id, title, order_index, correct_answer, static_code, gps_point
)
values
  ('3e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001', 'Completed task', 0, 'SECRET-ANSWER-1', 'SECRET-CODE-1', public.st_setsrid(public.st_makepoint(33.5, 44.6), 4326)),
  ('3e000000-0000-4000-8000-000000000002', '2e000000-0000-4000-8000-000000000001', 'Current task', 1, 'SECRET-ANSWER-2', 'SECRET-CODE-2', public.st_setsrid(public.st_makepoint(33.6, 44.7), 4326)),
  ('3e000000-0000-4000-8000-000000000003', '2e000000-0000-4000-8000-000000000001', 'Hidden future task', 2, 'SECRET-ANSWER-3', 'SECRET-CODE-3', public.st_setsrid(public.st_makepoint(33.7, 44.8), 4326)),
  ('3e000000-0000-4000-8000-000000000004', '2e000000-0000-4000-8000-000000000002', 'Free task one', 0, 'FREE-ANSWER-1', 'FREE-CODE-1', null),
  ('3e000000-0000-4000-8000-000000000005', '2e000000-0000-4000-8000-000000000002', 'Free task two', 1, 'FREE-ANSWER-2', 'FREE-CODE-2', null);

select set_config('request.jwt.claim.sub', '1e000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select public.start_quest_attempt_for_participant(
  '2e000000-0000-4000-8000-000000000001',
  '1e000000-0000-4000-8000-000000000002'
);

reset role;

insert into public.task_attempts (
  quest_attempt_id, task_id, opened, attempts_used, completed, failed
)
select attempt.id, '3e000000-0000-4000-8000-000000000001', true, 1, true, false
from public.quest_attempts attempt
where attempt.quest_id = '2e000000-0000-4000-8000-000000000001'
  and attempt.participant_profile_id = '1e000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claim.sub', '1e000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002'
  )->>'navigation_mode'),
  'sequential',
  'summary returns the configured navigation mode'
);

select is(
  jsonb_array_length(public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002'
  )->'tasks'),
  2,
  'sequential summary includes terminal tasks and only the current task'
);

select is(
  public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002'
  )->'tasks'->0->>'status',
  'completed',
  'terminal task state comes from the server attempt'
);

select ok(
  public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002'
  )::text not like '%Hidden future task%',
  'sequential summary does not disclose future task metadata'
);

select ok(
  public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002'
  )::text not like '%SECRET-%'
  and public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002'
  )::text not like '%POINT%',
  'summary does not disclose answers, codes, or exact coordinates'
);

select throws_ok(
  $$select public.submit_task_event(
    (select id from public.quest_attempts
      where quest_id = '2e000000-0000-4000-8000-000000000001'
        and participant_profile_id = '1e000000-0000-4000-8000-000000000002'),
    '3e000000-0000-4000-8000-000000000003',
    '4e000000-0000-4000-8000-000000000001',
    'open', null, 44.8, 33.7
  )$$,
  '23514',
  'task is not available in sequential mode',
  'server rejects a future sequential task even when the full package is cached'
);

select is(
  (public.submit_task_event(
    (select id from public.quest_attempts
      where quest_id = '2e000000-0000-4000-8000-000000000001'
        and participant_profile_id = '1e000000-0000-4000-8000-000000000002'),
    '3e000000-0000-4000-8000-000000000002',
    '4e000000-0000-4000-8000-000000000002',
    'open', null, 44.7, 33.6
  )->>'opened')::boolean,
  true,
  'server allows the current sequential task'
);

select is(
  jsonb_array_length(public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000002',
    '1e000000-0000-4000-8000-000000000002'
  )->'tasks'),
  2,
  'free summary exposes every task card allowed by the server'
);

select throws_ok(
  $$select public.get_participant_quest_summary(
    '2e000000-0000-4000-8000-000000000003',
    '1e000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'quest access denied',
  'summary rejects a participant without quest access'
);

select * from finish();
rollback;
