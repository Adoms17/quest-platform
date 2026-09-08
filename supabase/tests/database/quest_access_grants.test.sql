begin;

select plan(26);

insert into auth.users (id, email, raw_user_meta_data) values
  ('1b000000-0000-4000-8000-000000000001', 'access-owner@example.test', '{"username":"Access owner"}'),
  ('1b000000-0000-4000-8000-000000000002', 'invited@example.test', '{"username":"Invited"}'),
  ('1b000000-0000-4000-8000-000000000003', 'outsider-access@example.test', '{"username":"Outsider"}');

insert into public.quests (id, creator_id, organization_id, title, is_public)
values (
  '2b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000001',
  (select id from public.organizations where personal_owner_id = '1b000000-0000-4000-8000-000000000001'),
  'Private access quest', false
);
insert into public.tasks (id, quest_id, title)
values ('3b000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000001', 'Private task');

select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select set_config(
    'app.test_access_token',
    (select credential_token from public.create_quest_access_credential(
      '2b000000-0000-4000-8000-000000000001', 'invitation', ' INVITED@example.test ', 1
    )), true
  )$$,
  'owner can create an email-bound quest invitation'
);
reset role;

select matches((select token_hash from public.quest_access_credentials order by created_at desc limit 1),
  '^[0-9a-f]{64}$', 'only a SHA-256 credential hash is stored');
select is((select email from public.quest_access_credentials order by created_at desc limit 1),
  'invited@example.test', 'credential email is normalized');

select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  format('select * from public.redeem_quest_access_credential(%L)', current_setting('app.test_access_token')),
  '42501', 'quest access credential belongs to another account',
  'an email-bound credential rejects another account'
);
select is(
  (select count(*) from public.get_quest_access_preview(current_setting('app.test_access_token'))),
  0::bigint,
  'another account cannot preview an email-bound invitation'
);
select is((select count(*) from public.quest_access_credentials), 0::bigint,
  'participant cannot list access credentials');
select throws_ok(
  $$select public.create_quest_access_credential('2b000000-0000-4000-8000-000000000001', 'link')$$,
  '42501', 'quest access management denied', 'outsider cannot create credentials'
);
select throws_ok(
  $$select public.get_participant_tasks('2b000000-0000-4000-8000-000000000001')$$,
  '42501', 'quest access denied', 'outsider cannot load private tasks'
);
select throws_ok(
  $$select public.get_quest_access_grants('2b000000-0000-4000-8000-000000000001')$$,
  '42501', 'quest access management denied',
  'outsider cannot list participant identities for access grants'
);
reset role;

select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select quest_title from public.get_quest_access_preview(current_setting('app.test_access_token'))),
  'Private access quest',
  'invited account can preview non-secret quest context'
);
select lives_ok(
  format('select * from public.redeem_quest_access_credential(%L)', current_setting('app.test_access_token')),
  'matching account can redeem the invitation'
);
select ok(public.can_access_quest('2b000000-0000-4000-8000-000000000001'),
  'active grant permits private quest access');
select is(
  (select count(*) from public.quests where id = '2b000000-0000-4000-8000-000000000001'),
  1::bigint,
  'grantee can read private quest metadata needed by the participant page'
);
select lives_ok(
  $$select public.get_participant_tasks('2b000000-0000-4000-8000-000000000001')$$,
  'grantee can load participant-safe tasks'
);
select lives_ok(
  $$select set_config('app.test_granted_attempt_id',
    (select id::text from public.start_quest_attempt('2b000000-0000-4000-8000-000000000001')), true)$$,
  'grantee can start an attempt while access is active'
);
select lives_ok(
  format('select * from public.redeem_quest_access_credential(%L)', current_setting('app.test_access_token')),
  'credential redemption retry is idempotent'
);
select is((select count(*) from public.quest_access_grants where user_id = auth.uid()), 1::bigint,
  'retry creates one grant');
select is((select count(*) from public.quest_access_credentials), 0::bigint,
  'grantee cannot list credentials after redemption');

reset role;
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select redemption_count from public.quest_access_credentials order by created_at desc limit 1),
  1, 'retry consumes one redemption');
select lives_ok(
  $$select public.revoke_quest_access_credential((select id from public.quest_access_credentials order by created_at desc limit 1))$$,
  'owner can revoke an access credential'
);
select is((select count(*) from public.organization_audit_events
  where action = 'quest_access.credential_created'), 1::bigint,
  'credential creation is audited');
select is((select count(*) from public.organization_audit_events
  where action = 'quest_access.credential_redeemed'), 1::bigint,
  'credential redemption is audited once after retry');
select is(
  (select email from public.get_quest_access_grants('2b000000-0000-4000-8000-000000000001') limit 1),
  'invited@example.test',
  'access manager sees a useful participant identity through the protected RPC'
);
select lives_ok(
  $$select public.revoke_quest_access_grant((select id from public.quest_access_grants
    where user_id = '1b000000-0000-4000-8000-000000000002'))$$,
  'owner can revoke a participant grant'
);

reset role;
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok(not public.can_access_quest('2b000000-0000-4000-8000-000000000001'),
  'revoked grant no longer permits private quest access');
select throws_ok(
  format(
    $$select public.submit_task_event(%L::uuid, '3b000000-0000-4000-8000-000000000001',
      '4b000000-0000-4000-8000-000000000001', 'open')$$,
    current_setting('app.test_granted_attempt_id')
  ),
  '42501', 'quest attempt access denied',
  'revocation blocks new progress in an already opened attempt'
);

reset role;
select * from finish();
rollback;
