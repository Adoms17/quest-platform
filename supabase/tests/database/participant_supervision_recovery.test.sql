begin;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('8e000000-0000-4000-8000-000000000001', 'recovery-owner@example.test', '{"username":"Владелец"}'::jsonb),
  ('8e000000-0000-4000-8000-000000000002', 'recovery-adult@example.test', '{"username":"Второй взрослый"}'::jsonb),
  ('8e000000-0000-4000-8000-000000000003', 'recovery-outsider@example.test', '{"username":"Посторонний"}'::jsonb);

insert into public.participant_profiles (
  id, display_name, profile_kind, age_group, created_by_user_id
) values (
  '8e200000-0000-4000-8000-000000000001', 'Ребёнок', 'dependent', 'child',
  '8e000000-0000-4000-8000-000000000001'
);

insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values
  ('8e000000-0000-4000-8000-000000000001', '8e200000-0000-4000-8000-000000000001'),
  ('8e000000-0000-4000-8000-000000000002', '8e200000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '8e000000-0000-4000-8000-000000000002', true);
select public.set_my_participant_supervision_status(
  '8e200000-0000-4000-8000-000000000001', 'suspended'
);
select is(
  (select supervision_status from public.get_my_participant_profiles()
   where participant_profile_id = '8e200000-0000-4000-8000-000000000001'),
  'suspended',
  'a secondary adult can still see a suspended profile and resume it'
);
select is(
  (select count(*) from public.get_my_participant_audit_feed()
   where action = 'supervision.status_changed'),
  1::bigint,
  'an adult can still see their own profile action history'
);
select public.set_my_participant_supervision_status(
  '8e200000-0000-4000-8000-000000000001', 'active'
);
select set_config('app.test_recovery_group_id', public.create_participant_group('Группа второго взрослого')::text, true);
select public.set_participant_group_member(
  current_setting('app.test_recovery_group_id')::uuid,
  '8e200000-0000-4000-8000-000000000001',
  'member',
  'active'
);
select lives_ok(
  $$select public.revoke_my_participant_supervision(
    '8e200000-0000-4000-8000-000000000001'
  )$$,
  'a secondary adult can relinquish their own profile access'
);
select is(
  (select count(*) from public.get_my_participant_profiles()
   where participant_profile_id = '8e200000-0000-4000-8000-000000000001'),
  1::bigint,
  'group leadership keeps the profile available after explicit supervision is revoked'
);
select is(
  (select count(*) from public.get_managed_participant_supervisors()
   where participant_profile_id = '8e200000-0000-4000-8000-000000000001'
     and supervision_status = 'revoked'
     and can_manage),
  1::bigint,
  'the group leader can still manage supervision for a group participant'
);
select is(
  (select count(*)
   from public.get_my_participant_groups() participant_group,
        jsonb_array_elements(participant_group.members) member
   where member ->> 'participant_profile_id' = '8e200000-0000-4000-8000-000000000001'),
  1::bigint,
  'the profile stays visible through group leadership'
);

select set_config('request.jwt.claim.sub', '8e000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.revoke_my_participant_supervision(
    '8e200000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'last participant supervisor cannot be revoked',
  'the last guardian cannot be revoked from an unclaimed child profile'
);

reset role;
update public.participant_supervisions
set status = 'revoked'
where participant_profile_id = '8e200000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '8e000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.restore_orphaned_participant_supervision(
    '8e200000-0000-4000-8000-000000000001'
  )$$,
  'the profile creator can recover a legacy orphaned profile'
);
select is(
  (select status from public.participant_supervisions
   where participant_profile_id = '8e200000-0000-4000-8000-000000000001'
     and supervisor_user_id = '8e000000-0000-4000-8000-000000000001'),
  'active',
  'recovery restores active supervision'
);
select throws_ok(
  $$select public.restore_orphaned_participant_supervision(
    '8e200000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'participant profile is not orphaned',
  'an active profile cannot be recovered twice'
);

select set_config('request.jwt.claim.sub', '8e000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.restore_orphaned_participant_supervision(
    '8e200000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'participant supervision recovery denied',
  'an outsider cannot recover the participant profile'
);
select is(
  (select count(*) from public.get_my_participant_audit_feed()),
  0::bigint,
  'an outsider cannot read participant audit history'
);

select * from finish();
rollback;
