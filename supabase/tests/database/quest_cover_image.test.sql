begin;

select plan(5);

select has_column(
  'public',
  'quests',
  'cover_image_url',
  'quests have an optional cover image URL'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('7e000000-0000-4000-8000-000000000001', 'cover-owner@example.test', '{}'::jsonb),
  ('7e000000-0000-4000-8000-000000000002', 'cover-player@example.test', '{}'::jsonb),
  ('7e000000-0000-4000-8000-000000000003', 'cover-outsider@example.test', '{}'::jsonb);

insert into public.quests (
  id, creator_id, organization_id, title, is_public
)
select
  '8e000000-0000-4000-8000-000000000001',
  '7e000000-0000-4000-8000-000000000001',
  organization.id,
  'Quest with cover',
  true
from public.organizations organization
where organization.personal_owner_id = '7e000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$update public.quests
    set cover_image_url = 'https://example.test/cover.jpg'
    where id = '8e000000-0000-4000-8000-000000000001'$$,
  'quest owner can update the cover image'
);

select is(
  (select cover_image_url from public.quests
    where id = '8e000000-0000-4000-8000-000000000001'),
  'https://example.test/cover.jpg',
  'quest owner reads the saved cover image'
);

reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  public.get_participant_quest_for_profile(
    '8e000000-0000-4000-8000-000000000001',
    '7e000000-0000-4000-8000-000000000002'
  )->>'cover_image_url',
  'https://example.test/cover.jpg',
  'authorized participant receives the cover image'
);

reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000003', true);
set local role authenticated;

update public.quests
set cover_image_url = 'https://attacker.example/cover.jpg'
where id = '8e000000-0000-4000-8000-000000000001';

select is(
  (select cover_image_url from public.quests
    where id = '8e000000-0000-4000-8000-000000000001'),
  'https://example.test/cover.jpg',
  'unrelated user cannot update the cover image'
);

select * from finish();
rollback;
