begin;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('1c000000-0000-4000-8000-000000000001', 'limit-owner@example.test', '{"username":"limit-owner"}'::jsonb),
  ('1c000000-0000-4000-8000-000000000002', 'limit-player@example.test', '{"username":"limit-player"}'::jsonb);

insert into public.quests (
  id, creator_id, organization_id, title, is_public, max_quest_attempts
)
select
  seed.id,
  '1c000000-0000-4000-8000-000000000001'::uuid,
  organization.id,
  seed.title,
  true,
  seed.attempt_limit
from (
  values
    ('2c000000-0000-4000-8000-000000000001'::uuid, 'Limited quest', 1),
    ('2c000000-0000-4000-8000-000000000002'::uuid, 'Resumable quest', 1),
    ('2c000000-0000-4000-8000-000000000003'::uuid, 'Unlimited quest', 0)
) as seed(id, title, attempt_limit)
join public.organizations organization
  on organization.personal_owner_id = '1c000000-0000-4000-8000-000000000001';

insert into public.quest_attempts (id, quest_id, user_id, finished_at, total_tasks)
values
  ('3c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000002', now(), 0),
  ('3c000000-0000-4000-8000-000000000002', '2c000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000002', now(), 0),
  ('3c000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000002', null, 0),
  ('3c000000-0000-4000-8000-000000000004', '2c000000-0000-4000-8000-000000000003', '1c000000-0000-4000-8000-000000000002', now(), 0);

select set_config('request.jwt.claim.sub', '1c000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select public.start_quest_attempt('2c000000-0000-4000-8000-000000000001')$$,
  '23514',
  'quest completion limit reached',
  'a participant cannot start beyond the completed quest limit'
);

select is(
  (select id from public.start_quest_attempt('2c000000-0000-4000-8000-000000000002')),
  '3c000000-0000-4000-8000-000000000003'::uuid,
  'an active attempt can be resumed after the completion limit is reached'
);

select lives_ok(
  $$select public.start_quest_attempt('2c000000-0000-4000-8000-000000000003')$$,
  'zero allows unlimited completed attempts'
);

reset role;

select throws_ok(
  $$update public.quests set max_quest_attempts = -1 where id = '2c000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'negative quest completion limits are rejected'
);

select * from finish();
rollback;
