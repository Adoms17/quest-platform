begin;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('1e000000-0000-4000-8000-000000000001', 'code-owner@example.test', '{"username":"Code owner"}'),
  ('1e000000-0000-4000-8000-000000000002', 'code-user@example.test', '{"username":"Code user"}'),
  ('1e000000-0000-4000-8000-000000000003', 'limited-user@example.test', '{"username":"Limited user"}');

insert into public.quests (id, creator_id, organization_id, title, is_public)
values (
  '2e000000-0000-4000-8000-000000000001',
  '1e000000-0000-4000-8000-000000000001',
  (select id from public.organizations where personal_owner_id = '1e000000-0000-4000-8000-000000000001'),
  'Short code quest', false
);

select set_config('request.jwt.claim.sub', '1e000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select set_config('app.test_short_code',
    (select credential_token from public.create_quest_access_credential(
      '2e000000-0000-4000-8000-000000000001', 'code', 'must-not-bind@example.test', 2
    )), true)$$,
  'owner can create a short access code'
);
select matches(current_setting('app.test_short_code'), '^[0-9A-F]{6}-[0-9A-F]{6}$',
  'short code has a readable grouped format');
reset role;

select is((select count(*) from public.quest_access_credentials
  where token_hash = current_setting('app.test_short_code')), 0::bigint,
  'raw short code is not stored');
select is((select max_redemptions from public.quest_access_credentials
  where quest_id = '2e000000-0000-4000-8000-000000000001' and kind = 'code'), 2,
  'participant limit is stored for a code');
select is((select email from public.quest_access_credentials
  where quest_id = '2e000000-0000-4000-8000-000000000001' and kind = 'code'), null,
  'server ignores an email accidentally supplied for a shared code');

select set_config('request.jwt.claim.sub', '1e000000-0000-4000-8000-000000000003', true);
set local role service_role;
select is((select error_code from public.redeem_quest_access_code('BAD001')), 'invalid', 'first bad code is rejected');
select is((select error_code from public.redeem_quest_access_code('BAD002')), 'invalid', 'second bad code is rejected');
select is((select error_code from public.redeem_quest_access_code('BAD003')), 'invalid', 'third bad code is rejected');
select is((select error_code from public.redeem_quest_access_code('BAD004')), 'invalid', 'fourth bad code is rejected');
select is((select error_code from public.redeem_quest_access_code('BAD005')), 'invalid', 'fifth bad code is rejected');
select is((select error_code from public.redeem_quest_access_code(current_setting('app.test_short_code'))),
  'rate_limited', 'sixth attempt is blocked even when the code is valid');
select ok((select retry_after_seconds > 0 from public.redeem_quest_access_code('BAD006')),
  'rate limit returns a positive retry delay');
reset role;
set local role authenticated;
select ok(not has_table_privilege('quest_access_code_attempts', 'select'),
  'participant has no read privilege for the attempt log');
reset role;

select set_config('request.jwt.claim.sub', '1e000000-0000-4000-8000-000000000002', true);
set local role service_role;
select ok((select success from public.redeem_quest_access_code(current_setting('app.test_short_code'))),
  'another user can redeem a valid formatted code');
select ok((select success from public.redeem_quest_access_code(replace(current_setting('app.test_short_code'), '-', ''))),
  'redemption retry is idempotent and accepts an ungrouped code');

reset role;
select * from finish();
rollback;
