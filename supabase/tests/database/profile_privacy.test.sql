begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11000000-0000-4000-8000-000000000001', 'creator@example.test', '{"username":"creator"}'::jsonb),
  ('11000000-0000-4000-8000-000000000002', 'participant@example.test', '{}'::jsonb),
  ('11000000-0000-4000-8000-000000000003', 'outsider@example.test', '{"username":"outsider"}'::jsonb);

insert into public.quests (id, creator_id, title)
values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Profile privacy quest'
);

insert into public.quest_attempts (id, quest_id, user_id, total_tasks)
values (
  '41000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002',
  0
);

select ok(
  (select username is null
   from public.profiles
   where id = '11000000-0000-4000-8000-000000000002'),
  'new profiles do not fall back to email addresses'
);

set local role anon;

select is(
  (select count(*) from public.profiles),
  0::bigint,
  'anonymous users cannot read profiles'
);

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  2::bigint,
  'a creator sees their own profile and a participant profile'
);

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a participant sees only their own profile'
);

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'an unrelated user sees only their own profile'
);

reset role;
select * from finish();

rollback;
