begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('7d000000-0000-4000-8000-000000000001', 'audit-family-owner@example.test', '{"username":"Владелец"}'::jsonb),
  ('7d000000-0000-4000-8000-000000000002', 'audit-family-adult@example.test', '{"username":"Второй взрослый"}'::jsonb),
  ('7d000000-0000-4000-8000-000000000003', 'audit-family-outsider@example.test', '{"username":"Посторонний"}'::jsonb);
insert into public.participant_profiles (
  id, display_name, profile_kind, age_group, created_by_user_id
) values (
  '7d200000-0000-4000-8000-000000000001', 'Участник', 'dependent', 'child',
  '7d000000-0000-4000-8000-000000000001'
);
insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values
  ('7d000000-0000-4000-8000-000000000001', '7d200000-0000-4000-8000-000000000001'),
  ('7d000000-0000-4000-8000-000000000002', '7d200000-0000-4000-8000-000000000001');

set local role authenticated;
select is(
  has_table_privilege('public.participant_audit_events', 'SELECT'),
  false,
  'authenticated clients cannot read the private audit table directly'
);

select set_config('request.jwt.claim.sub', '7d000000-0000-4000-8000-000000000001', true);
select set_config('app.test_participant_invitation_id', (
  select invitation_id::text
  from public.create_participant_profile_invitation(
    '7d200000-0000-4000-8000-000000000001',
    'supervisor',
    'new-adult@example.test'
  )
), true);
select public.revoke_participant_supervisor(
  '7d200000-0000-4000-8000-000000000001',
  '7d000000-0000-4000-8000-000000000002'
);

select ok(
  (select count(*) from public.get_my_participant_audit_feed()) >= 4,
  'profile owner can read the participant audit feed'
);
select is(
  (select actor_username from public.get_my_participant_audit_feed() where action = 'invitation.created' limit 1),
  'Владелец',
  'audit feed identifies the acting account'
);
select is(
  (select subject_username from public.get_my_participant_audit_feed() where action = 'supervision.status_changed' limit 1),
  'Второй взрослый',
  'audit feed resolves the affected adult without exposing an identifier'
);
select ok(
  not exists (
    select 1 from public.get_my_participant_audit_feed()
    where metadata ?| array['email', 'phone', 'token', 'token_hash', 'latitude', 'longitude']
  ),
  'audit metadata contains no contacts, secrets, or coordinates'
);
select is(
  (select count(*) from public.get_my_participant_audit_feed(0)),
  1::bigint,
  'participant audit feed clamps the requested limit'
);

reset role;
select set_config('request.jwt.claim.sub', '7d000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.get_my_participant_audit_feed()),
  0::bigint,
  'outsider cannot read another participant audit feed'
);

select * from finish();
rollback;
