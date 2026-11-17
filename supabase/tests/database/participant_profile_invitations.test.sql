begin;

select no_plan();

insert into auth.users (id, email, raw_user_meta_data)
values
  ('6f000000-0000-4000-8000-000000000001', 'parent@example.test', '{"username":"Parent"}'::jsonb),
  ('6f000000-0000-4000-8000-000000000002', 'second-parent@example.test', '{"username":"Second parent"}'::jsonb),
  ('6f000000-0000-4000-8000-000000000003', 'child-account@example.test', '{"username":"New account"}'::jsonb),
  ('6f000000-0000-4000-8000-000000000004', 'outsider-claim@example.test', '{"username":"Outsider"}'::jsonb);

select set_config('request.jwt.claim.sub', '6f000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select set_config(
  'app.test_participant_group_id',
  public.create_participant_group('Claim family')::text,
  true
);
select set_config(
  'app.test_invited_profile_id',
  public.create_dependent_participant_profile(
    'Участник',
    'teen',
    current_setting('app.test_participant_group_id')::uuid
  )::text,
  true
);
select set_config(
  'app.test_supervisor_token',
  (select invitation_token from public.create_participant_profile_invitation(
    current_setting('app.test_invited_profile_id')::uuid, 'supervisor', 'second-parent@example.test'
  )), true
);
select set_config(
  'app.test_claim_token',
  (select invitation_token from public.create_participant_profile_invitation(
    current_setting('app.test_invited_profile_id')::uuid, 'claim', 'child-account@example.test'
  )), true
);

select is((select count(*) from public.get_my_participant_profile_invitations()), 2::bigint, 'creator can list sent invitations');
select is(
  (select email from public.get_my_participant_profile_invitations() where invitation_kind = 'claim'),
  'child-account@example.test',
  'sent invitation list identifies its email recipient'
);

reset role;
insert into public.quests (id, creator_id, title, is_public)
values (
  '6f100000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000001',
  'Claim history quest',
  false
);
insert into public.quest_access_grants (quest_id, user_id, participant_profile_id)
values (
  '6f100000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000001',
  current_setting('app.test_invited_profile_id')::uuid
);
insert into public.quest_attempts (
  id, quest_id, user_id, actor_user_id, participant_profile_id,
  total_tasks, completed_tasks, finished_at
) values (
  '6f300000-0000-4000-8000-000000000001',
  '6f100000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000001',
  current_setting('app.test_invited_profile_id')::uuid,
  1,
  1,
  now()
);
insert into public.quest_access_grants (quest_id, user_id, participant_profile_id)
values (
  '6f100000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000003',
  '6f000000-0000-4000-8000-000000000003'
);
insert into public.quest_attempts (
  id, quest_id, user_id, actor_user_id, participant_profile_id,
  total_tasks, completed_tasks, finished_at
) values (
  '6f300000-0000-4000-8000-000000000002',
  '6f100000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000003',
  '6f000000-0000-4000-8000-000000000003',
  '6f000000-0000-4000-8000-000000000003',
  1,
  0,
  null
);

select set_config('request.jwt.claim.sub', '6f000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(
  (select count(*) from public.get_participant_profile_invitation_preview(current_setting('app.test_claim_token'))),
  0::bigint,
  'an account with another email cannot preview the invitation'
);
select throws_ok(
  format($$select * from public.accept_participant_profile_invitation(%L)$$, current_setting('app.test_claim_token')),
  '42501', 'participant invitation belongs to another account',
  'an account with another email cannot accept the invitation'
);

reset role;
select set_config('request.jwt.claim.sub', '6f000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  format($$select * from public.accept_participant_profile_invitation(%L)$$, current_setting('app.test_supervisor_token')),
  'second adult can accept an email-bound supervision invitation'
);
select ok(
  public.can_access_participant_profile(current_setting('app.test_invited_profile_id')::uuid),
  'second adult can access the supervised profile'
);

reset role;
select set_config('request.jwt.claim.sub', '6f000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select participant_display_name from public.get_participant_profile_invitation_preview(current_setting('app.test_claim_token'))),
  'Участник',
  'intended account sees minimal claim context'
);
select throws_ok(
  format($$select * from public.accept_participant_profile_invitation(%L)$$, current_setting('app.test_claim_token')),
  '55000',
  'self participant profile has active quest attempt',
  'claim refuses to alter an active attempt on the automatically provisioned profile'
);
select lives_ok($$select public.register_offline_quest_attempt(
  '6f100000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000003',
  'local-before-claim', '6f300000-0000-4000-8000-000000000002')$$,
  'offline identity registered before profile merge');
select is(
  (select count(*) from public.get_participant_profile_invitation_preview(current_setting('app.test_claim_token'))),
  1::bigint,
  'failed merge leaves the invitation available for retry'
);
reset role;
select is((select count(*) from public.participant_usage_profile_merges where source_profile_id='6f000000-0000-4000-8000-000000000003'),0::bigint,'failed claim leaves no usage merge');
update public.quest_attempts
set finished_at = now()
where id = '6f300000-0000-4000-8000-000000000002';
insert into public.quests(id,creator_id,title,is_public,is_open) values(md5('claim-permit-quest')::uuid,'6f000000-0000-4000-8000-000000000001','Permit merge',true,true);
update public.organization_subscriptions set status='free',plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1)
 where organization_id=(select organization_id from public.quests where id=md5('claim-permit-quest')::uuid);
select set_config('test.claim_permit',public.prepare_offline_start_permit(md5('claim-permit-quest')::uuid,'6f000000-0000-4000-8000-000000000003',md5('claim-permit-command')::uuid)->>'id',true);
savepoint conflicting_reserves;
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000001',true);
select public.prepare_offline_start_permit(md5('claim-permit-quest')::uuid,current_setting('app.test_invited_profile_id')::uuid,md5('target-permit-command')::uuid);
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000003',true);
select throws_ok(format($$select * from public.accept_participant_profile_invitation(%L)$$,current_setting('app.test_claim_token')),'55000','participant merge has conflicting offline permits','two reserves prevent unsafe automatic merge');
rollback to conflicting_reserves;

set local role authenticated;
select set_config('request.jwt.claim.sub', '6f000000-0000-4000-8000-000000000003', true);
select lives_ok(
  format($$select * from public.accept_participant_profile_invitation(%L)$$, current_setting('app.test_claim_token')),
  'intended account can claim the existing participant profile'
);
select is(
  (select participant_profile_id from public.participant_profile_accounts
   where user_id = '6f000000-0000-4000-8000-000000000003' and relationship = 'self' and status = 'active'),
  current_setting('app.test_invited_profile_id')::uuid,
  'claim links the account to the existing stable participant profile'
);
select is(
  (select display_name from public.participant_profiles
   where id = current_setting('app.test_invited_profile_id')::uuid),
  'New account',
  'claimed profile keeps the personal name entered during account registration'
);
select is(
  (select count(*) from public.participant_group_members
   where group_id = current_setting('app.test_participant_group_id')::uuid
     and participant_profile_id = current_setting('app.test_invited_profile_id')::uuid
     and status = 'active'),
  1::bigint,
  'claim preserves participant group membership'
);
select is(
  (select count(*) from public.quest_access_grants
   where participant_profile_id = current_setting('app.test_invited_profile_id')::uuid
     and status = 'active'),
  1::bigint,
  'claim preserves participant quest grants'
);
select is(
  (select count(*) from public.get_participant_quest_history(
    current_setting('app.test_invited_profile_id')::uuid
  )),
  2::bigint,
  'claimed account can read both preserved and merged participant history'
);
reset role;
select is(
  (select count(*) from public.quest_attempts
   where participant_profile_id = current_setting('app.test_invited_profile_id')::uuid
     and finished_at is not null),
  2::bigint,
  'claim preserves and merges participant quest attempts'
);
select is(
  (select count(*) from public.quest_attempts
   where participant_profile_id = current_setting('app.test_invited_profile_id')::uuid
     and finished_at is not null),
  2::bigint,
  'claim merges completed history from the automatically provisioned profile'
);
select is(
  (select count(*) from public.quest_attempts
   where participant_profile_id = '6f000000-0000-4000-8000-000000000003'),
  0::bigint,
  'archived profile keeps no detached quest attempts'
);
select is(
  (select count(*) from public.quest_access_grants
   where participant_profile_id = current_setting('app.test_invited_profile_id')::uuid),
  2::bigint,
  'claim merges quest grants and safely retains duplicate grant history'
);
select is(
  (select status from public.participant_profiles where id = '6f000000-0000-4000-8000-000000000003'),
  'archived',
  'unused automatically provisioned self profile is archived'
);
set local role authenticated;
select lives_ok(
  format($$select * from public.accept_participant_profile_invitation(%L)$$, current_setting('app.test_claim_token')),
  'claim retry is idempotent'
);

reset role;
select is(public.participant_usage_identity('6f000000-0000-4000-8000-000000000003'::uuid),public.participant_usage_identity(current_setting('app.test_invited_profile_id')::uuid),'successful claim merges usage identity');
set local role authenticated;
select is(public.register_offline_quest_attempt(
  '6f100000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000003',
  'local-before-claim', '6f300000-0000-4000-8000-000000000002')->>'id',
  '6f300000-0000-4000-8000-000000000002','old profile retry preserves the same finished attempt');
select is(public.register_offline_quest_attempt(
  '6f100000-0000-4000-8000-000000000001',current_setting('app.test_invited_profile_id')::uuid,
  'local-before-claim','6f300000-0000-4000-8000-000000000002')->>'id',
  '6f300000-0000-4000-8000-000000000002','new profile resolves the same registered identity');
reset role;
select is((select participant_profile_id from public.offline_attempt_registrations
  where actor_user_id='6f000000-0000-4000-8000-000000000003' and local_attempt_id='local-before-claim'),
  current_setting('app.test_invited_profile_id')::uuid,'registration follows explicit profile merge');
select is((select participant_profile_id from public.offline_start_permits where id=current_setting('test.claim_permit')::uuid),current_setting('app.test_invited_profile_id')::uuid,'reserve moved without changing permit ID');
select set_config('test.claim_attempt',public.register_permitted_offline_attempt(md5('claim-permit-quest')::uuid,'6f000000-0000-4000-8000-000000000003','old-device',current_setting('test.claim_permit')::uuid)->>'id',true);
select is(public.register_permitted_offline_attempt(md5('claim-permit-quest')::uuid,'6f000000-0000-4000-8000-000000000003','old-device',current_setting('test.claim_permit')::uuid)->>'id',current_setting('test.claim_attempt'),'old device retry after merge keeps one attempt');
select is((select participant_profile_id from public.quest_attempts where id=current_setting('test.claim_attempt')::uuid),current_setting('app.test_invited_profile_id')::uuid,'redeemed attempt belongs to merged profile');
select * from finish();
rollback;
