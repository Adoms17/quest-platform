begin;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('7e000000-0000-4000-8000-000000000001', 'supervision-owner@example.test', '{"username":"Owner"}'::jsonb),
  ('7e000000-0000-4000-8000-000000000002', 'supervision-adult@example.test', '{"username":"Second adult"}'::jsonb),
  ('7e000000-0000-4000-8000-000000000003', 'supervision-outsider@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.participant_profiles (
  id, display_name, profile_kind, age_group, created_by_user_id
) values (
  '7e200000-0000-4000-8000-000000000001', 'Ребёнок', 'dependent', 'child',
  '7e000000-0000-4000-8000-000000000001'
);
insert into public.participant_supervisions (supervisor_user_id, participant_profile_id)
values
  ('7e000000-0000-4000-8000-000000000001', '7e200000-0000-4000-8000-000000000001'),
  ('7e000000-0000-4000-8000-000000000002', '7e200000-0000-4000-8000-000000000001');
insert into public.participant_groups (id, name, created_by_user_id)
values ('7e300000-0000-4000-8000-000000000001', 'Семья', '7e000000-0000-4000-8000-000000000001');
insert into public.participant_group_members (group_id, participant_profile_id)
values ('7e300000-0000-4000-8000-000000000001', '7e200000-0000-4000-8000-000000000001');
insert into public.quests (id, creator_id, title, is_public)
values ('7e400000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000001', 'Контроль доступа', false);
insert into public.tasks (id, quest_id, title)
values ('7e500000-0000-4000-8000-000000000001', '7e400000-0000-4000-8000-000000000001', 'Задание');
insert into public.quest_access_grants (quest_id, user_id, participant_profile_id)
values ('7e400000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000002', '7e200000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select set_config('app.test_supervision_attempt_id', (
  select id::text from public.start_quest_attempt_for_participant(
    '7e400000-0000-4000-8000-000000000001',
    '7e200000-0000-4000-8000-000000000001'
  )
), true);

reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.get_managed_participant_supervisors()), 2::bigint, 'profile owner can list supervisors');
select is(
  (select supervisor_email from public.get_managed_participant_supervisors() where supervisor_user_id = '7e000000-0000-4000-8000-000000000002'),
  'supervision-adult@example.test',
  'profile owner can distinguish supervisors by email'
);
select lives_ok(
  $$select public.revoke_participant_supervisor('7e200000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000002')$$,
  'profile owner can revoke another supervisor'
);

reset role;
select is(
  (select status from public.participant_supervisions where supervisor_user_id = '7e000000-0000-4000-8000-000000000002' and participant_profile_id = '7e200000-0000-4000-8000-000000000001'),
  'revoked',
  'revocation is persisted'
);
select isnt(
  (select revoked_at from public.participant_supervisions where supervisor_user_id = '7e000000-0000-4000-8000-000000000002' and participant_profile_id = '7e200000-0000-4000-8000-000000000001'),
  null,
  'revocation timestamp is recorded'
);

select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select isnt(public.can_access_participant_profile('7e200000-0000-4000-8000-000000000001'), true, 'revoked supervisor loses participant access immediately');
select isnt(public.can_access_participant_group('7e300000-0000-4000-8000-000000000001'), true, 'revoked supervisor loses group visibility immediately');
select throws_ok(
  format(
    $$select public.submit_task_event(%L::uuid, '7e500000-0000-4000-8000-000000000001', '7e600000-0000-4000-8000-000000000001', 'open')$$,
    current_setting('app.test_supervision_attempt_id')
  ),
  '42501', 'quest attempt access denied',
  'revoked supervisor cannot continue an existing quest attempt'
);

reset role;
update public.participant_supervisions
set status = 'active'
where supervisor_user_id = '7e000000-0000-4000-8000-000000000002'
  and participant_profile_id = '7e200000-0000-4000-8000-000000000001';
select is(
  (select revoked_at from public.participant_supervisions where supervisor_user_id = '7e000000-0000-4000-8000-000000000002' and participant_profile_id = '7e200000-0000-4000-8000-000000000001'),
  null,
  'reactivation clears the revocation timestamp'
);

select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  format(
    $$select public.submit_task_event(%L::uuid, '7e500000-0000-4000-8000-000000000001', '7e600000-0000-4000-8000-000000000001', 'open')$$,
    current_setting('app.test_supervision_attempt_id')
  ),
  'reactivated supervisor can continue the existing attempt'
);
reset role;
select is(
  (select count(*) from public.task_submission_events where client_event_id = '7e600000-0000-4000-8000-000000000001'),
  1::bigint,
  'rejected event is not consumed and succeeds once after access is restored'
);

select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.get_managed_participant_supervisors()), 0::bigint, 'outsider cannot list supervision relationships');
select throws_ok(
  $$select public.revoke_participant_supervisor('7e200000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000002')$$,
  '42501', 'participant supervision management denied',
  'outsider cannot revoke a supervisor'
);

select * from finish();
rollback;
