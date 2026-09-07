begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('1c000000-0000-4000-8000-000000000001', 'lifecycle-owner@example.test', '{"username":"Lifecycle owner"}'),
  ('1c000000-0000-4000-8000-000000000002', 'first-user@example.test', '{"username":"First user"}'),
  ('1c000000-0000-4000-8000-000000000003', 'second-user@example.test', '{"username":"Second user"}');

insert into public.quests (id, creator_id, organization_id, title, is_public)
values (
  '2c000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  (select id from public.organizations where personal_owner_id = '1c000000-0000-4000-8000-000000000001'),
  'Access lifecycle quest', false
);

select set_config('request.jwt.claim.sub', '1c000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select set_config('app.test_limited_token',
    (select credential_token from public.create_quest_access_credential(
      '2c000000-0000-4000-8000-000000000001', 'link', null, 1)), true)$$,
  'owner creates a single-redemption link'
);
select lives_ok(
  $$select set_config('app.test_revoked_token',
    (select credential_token from public.create_quest_access_credential(
      '2c000000-0000-4000-8000-000000000001', 'code', null, 2)), true)$$,
  'owner creates a credential that will be revoked'
);
select lives_ok(
  $$select public.revoke_quest_access_credential((select id
    from public.quest_access_credentials
    where token_hash = encode(extensions.digest(replace(current_setting('app.test_revoked_token'), '-', ''), 'sha256'), 'hex')))$$,
  'owner revokes a credential'
);
reset role;

insert into public.quest_access_credentials
  (quest_id, kind, token_hash, status, max_redemptions, expires_at, created_at, created_by)
values (
  '2c000000-0000-4000-8000-000000000001', 'link',
  encode(extensions.digest(repeat('e', 64), 'sha256'), 'hex'), 'expired', 1,
  now() - interval '1 day', now() - interval '2 days',
  '1c000000-0000-4000-8000-000000000001'
);

select set_config('request.jwt.claim.sub', '1c000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  format('select * from public.redeem_quest_access_credential(%L)', current_setting('app.test_limited_token')),
  'first user consumes the only redemption'
);
select is((select count(*) from public.quest_access_grants where user_id = auth.uid()), 1::bigint,
  'first user has one active grant');
reset role;

select set_config('request.jwt.claim.sub', '1c000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  format('select * from public.redeem_quest_access_credential(%L)', current_setting('app.test_limited_token')),
  '22023', 'invalid quest access credential', 'redemption limit rejects the next user'
);
select throws_ok(
  format('select * from public.redeem_quest_access_credential(%L)', repeat('e', 64)),
  '22023', 'invalid quest access credential', 'expired credential is rejected'
);
select throws_ok(
  format('select * from public.redeem_quest_access_credential(%L)', current_setting('app.test_revoked_token')),
  '22023', 'invalid quest access credential', 'revoked credential is rejected'
);
select is((select count(*) from public.quest_access_grants), 0::bigint,
  'participant sees no grants belonging to another user');
reset role;

select throws_ok(
  $$insert into public.quest_access_grants (quest_id, user_id)
    values ('2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000002')$$,
  '23505', null, 'database prevents concurrent duplicate active grants'
);

select * from finish();
rollback;
