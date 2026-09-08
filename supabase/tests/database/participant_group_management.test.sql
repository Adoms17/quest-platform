begin;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('5f000000-0000-4000-8000-000000000001', 'group-owner@example.test', '{"username":"Group owner"}'::jsonb),
  ('5f000000-0000-4000-8000-000000000002', 'group-outsider@example.test', '{"username":"Group outsider"}'::jsonb),
  ('5f000000-0000-4000-8000-000000000003', 'group-leader@example.test', '{"username":"Group leader"}'::jsonb);

select set_config('request.jwt.claim.sub', '5f000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select set_config('app.test_participant_group_id', public.create_participant_group('  Семья  ')::text, true);
select is(
  (select group_name from public.get_my_participant_groups() where group_id = current_setting('app.test_participant_group_id')::uuid),
  'Семья',
  'group name is normalized and group is visible to its creator'
);

select set_config(
  'app.test_dependent_profile_id',
  public.create_dependent_participant_profile(
    '  Миша  ', 'child', current_setting('app.test_participant_group_id')::uuid
  )::text,
  true
);

select is(
  (select display_name from public.get_my_participant_profiles() where participant_profile_id = current_setting('app.test_dependent_profile_id')::uuid),
  'Миша',
  'dependent profile name is normalized'
);
select is(
  (select age_group from public.get_my_participant_profiles() where participant_profile_id = current_setting('app.test_dependent_profile_id')::uuid),
  'child',
  'dependent profile stores only an age category'
);
select is(
  jsonb_array_length((select members from public.get_my_participant_groups() where group_id = current_setting('app.test_participant_group_id')::uuid)),
  2,
  'group contains its creator leader and the new dependent participant'
);
select ok(
  public.can_manage_participant_group(current_setting('app.test_participant_group_id')::uuid),
  'group creator can manage the group'
);
select lives_ok(
  format(
    $$select public.set_participant_group_member(%L::uuid, %L::uuid, 'leader', 'active')$$,
    current_setting('app.test_participant_group_id'),
    current_setting('app.test_dependent_profile_id')
  ),
  'group creator can appoint an accessible participant as leader'
);
select throws_ok(
  $$insert into public.participant_profiles (display_name, created_by_user_id) values ('Bypass', auth.uid())$$,
  '42501',
  null,
  'authenticated clients cannot bypass participant profile RPCs'
);

select lives_ok(
  format(
    $$select public.set_my_participant_supervision_status(%L::uuid, 'suspended')$$,
    current_setting('app.test_dependent_profile_id')
  ),
  'supervisor can suspend their own supervision'
);
select is(
  (select supervision_status from public.get_my_participant_profiles() where participant_profile_id = current_setting('app.test_dependent_profile_id')::uuid),
  'suspended',
  'suspended relationship remains visible for recovery'
);

reset role;
insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values (
  '5f000000-0000-4000-8000-000000000003',
  current_setting('app.test_dependent_profile_id')::uuid
);
select set_config('request.jwt.claim.sub', '5f000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select ok(
  public.can_manage_participant_group(current_setting('app.test_participant_group_id')::uuid),
  'account controlling a leader profile can manage the group'
);
select is(
  (select count(*) from public.get_my_participant_groups() where can_manage),
  1::bigint,
  'leader account sees the group as manageable'
);

reset role;
select set_config('request.jwt.claim.sub', '5f000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (select count(*) from public.get_my_participant_groups()),
  0::bigint,
  'outsider cannot list another account participant groups'
);
select throws_ok(
  format(
    $$select public.create_dependent_participant_profile('Чужой профиль', 'child', %L::uuid)$$,
    current_setting('app.test_participant_group_id')
  ),
  '42501',
  'participant group management denied',
  'outsider cannot add a profile to another account group'
);

select * from finish();
rollback;
