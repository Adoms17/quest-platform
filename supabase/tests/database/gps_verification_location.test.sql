begin;

select plan(3);

insert into auth.users (id, email)
values (
  '15000000-0000-0000-0000-000000000001',
  'gps-consistency-test@example.invalid'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quests'::regclass
      and conname = 'quests_gps_verification_requires_location_check'
      and contype = 'c'
  ),
  'quests enforce GPS verification/location consistency'
);

select lives_ok(
  $$
    insert into public.quests (
      id,
      creator_id,
      title,
      location_options,
      verification_options
    ) values (
      '25000000-0000-0000-0000-000000000001',
      '15000000-0000-0000-0000-000000000001',
      'Valid GPS quest',
      '["gps"]'::jsonb,
      '["gps"]'::jsonb
    )
  $$,
  'GPS verification is accepted when GPS describes the location'
);

select throws_ok(
  $$
    insert into public.quests (
      id,
      creator_id,
      title,
      location_options,
      verification_options
    ) values (
      '25000000-0000-0000-0000-000000000002',
      '15000000-0000-0000-0000-000000000001',
      'Invalid GPS quest',
      '["text"]'::jsonb,
      '["gps"]'::jsonb
    )
  $$,
  '23514',
  null,
  'GPS verification is rejected without GPS location data'
);

select * from finish();

rollback;
