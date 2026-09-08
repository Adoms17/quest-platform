begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('2f000000-0000-4000-8000-000000000001', 'adult-one@example.test', '{"username":"Adult one"}'::jsonb),
  ('2f000000-0000-4000-8000-000000000002', 'adult-two@example.test', '{"username":"Adult two"}'::jsonb),
  ('2f000000-0000-4000-8000-000000000003', 'unrelated@example.test', '{"username":"Unrelated"}'::jsonb);

select is(
  (select count(*) from public.participant_profiles where id in (
    '2f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000002'
  )),
  2::bigint,
  'new accounts automatically receive self participant profiles'
);

select is(
  (select count(*) from public.participant_profile_accounts where relationship = 'self' and user_id in (
    '2f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000002'
  )),
  2::bigint,
  'new accounts are linked to their self profiles'
);

insert into public.participant_profiles (id, display_name, profile_kind, age_group, created_by_user_id)
values ('3f000000-0000-4000-8000-000000000001', 'Ребёнок', 'dependent', 'child', '2f000000-0000-4000-8000-000000000001');

insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values
  ('2f000000-0000-4000-8000-000000000001', '3f000000-0000-4000-8000-000000000001'),
  ('2f000000-0000-4000-8000-000000000002', '3f000000-0000-4000-8000-000000000001');

insert into public.participant_groups (id, name, created_by_user_id)
values ('4f000000-0000-4000-8000-000000000001', 'Семья', '2f000000-0000-4000-8000-000000000001');

insert into public.participant_group_members (group_id, participant_profile_id, member_role)
values ('4f000000-0000-4000-8000-000000000001', '3f000000-0000-4000-8000-000000000001', 'member');

set local role anon;
select is(
  has_table_privilege('public.participant_profiles', 'SELECT'),
  false,
  'anonymous users have no read privilege on participant profiles'
);

reset role;
select set_config('request.jwt.claim.sub', '2f000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.participant_profiles), 2::bigint, 'first adult sees self and supervised child');
select ok(public.can_access_participant_group('4f000000-0000-4000-8000-000000000001'), 'group creator can access family group');

reset role;
select set_config('request.jwt.claim.sub', '2f000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*) from public.participant_profiles), 2::bigint, 'second adult sees self and the same supervised child');
select is((select count(*) from public.participant_groups), 1::bigint, 'second adult sees group through supervised child membership');

reset role;
select set_config('request.jwt.claim.sub', '2f000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.participant_profiles), 1::bigint, 'unrelated user sees only their self profile');
select is((select count(*) from public.participant_groups), 0::bigint, 'unrelated user cannot see family group');
select is((select count(*) from public.participant_supervisions), 0::bigint, 'unrelated user cannot see supervision links');

select * from finish();
rollback;
