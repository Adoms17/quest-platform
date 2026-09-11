begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('71000000-0000-4000-8000-000000000001', 'payload-owner@example.test', '{}'::jsonb),
  ('71000000-0000-4000-8000-000000000002', 'payload-player@example.test', '{}'::jsonb),
  ('71000000-0000-4000-8000-000000000003', 'payload-outsider@example.test', '{}'::jsonb);

insert into public.quests (
  id, creator_id, organization_id, title, description, is_public,
  verification_options, task_navigation_mode, cover_image_url
)
select
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  organization.id,
  'Safe payload quest',
  'Participant description',
  true,
  '["gps"]'::jsonb,
  'free',
  'https://example.test/cover.jpg'
from public.organizations organization
where organization.personal_owner_id = '71000000-0000-4000-8000-000000000001';

insert into public.quests (
  id, creator_id, organization_id, title, is_public
)
select
  '72000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001',
  organization.id,
  'Private payload quest',
  false
from public.organizations organization
where organization.personal_owner_id = '71000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  public.get_participant_quest('72000000-0000-4000-8000-000000000001')->>'title',
  'Safe payload quest',
  'participant projection contains display fields'
);

select is(
  public.get_participant_quest('72000000-0000-4000-8000-000000000001')->>'task_navigation_mode',
  'free',
  'participant projection contains navigation settings'
);

select ok(
  public.get_participant_quest('72000000-0000-4000-8000-000000000001') ? 'cover_image_url',
  'participant projection contains the cover'
);

select ok(
  not public.get_participant_quest('72000000-0000-4000-8000-000000000001') ? 'creator_id',
  'participant projection omits creator id'
);

select ok(
  not public.get_participant_quest('72000000-0000-4000-8000-000000000001') ? 'organization_id',
  'participant projection omits organization id'
);

select is(
  public.get_participant_quest_for_profile(
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002'
  )->>'description',
  'Participant description',
  'profile projection uses the same safe display fields'
);

select throws_ok(
  $$select public.get_participant_quest(
    '72000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'quest access denied',
  'participant projection rejects an inaccessible private quest'
);

select * from finish();
rollback;
