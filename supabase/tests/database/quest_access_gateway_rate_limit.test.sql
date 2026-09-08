begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values ('9a000000-0000-4000-8000-000000000001', 'gateway-user@example.test', '{"username":"Gateway user"}'::jsonb);

select isnt(
  has_function_privilege('authenticated', 'public.redeem_quest_access_code(text)', 'execute'),
  true,
  'authenticated clients cannot execute direct self-profile code redemption'
);
select isnt(
  has_function_privilege('authenticated', 'public.redeem_quest_access_code_for_participant(text,uuid)', 'execute'),
  true,
  'authenticated clients cannot execute direct participant code redemption'
);
select ok(
  has_function_privilege('service_role', 'public.redeem_quest_access_code(text)', 'execute'),
  'service role retains internal self-profile code redemption access'
);
select ok(
  has_function_privilege('service_role', 'public.redeem_quest_access_code_for_participant(text,uuid)', 'execute'),
  'service role retains internal participant code redemption access'
);

select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.redeem_quest_access_code_from_gateway(
    '9a000000-0000-4000-8000-000000000001', 'BAD-CODE', null,
    repeat('a', 64), repeat('b', 64)
  )$$,
  '42501', 'permission denied for function redeem_quest_access_code_from_gateway',
  'authenticated clients cannot execute the service-only gateway RPC'
);

reset role;
set local role service_role;
select throws_ok(
  $$select * from public.redeem_quest_access_code_from_gateway(
    '9a000000-0000-4000-8000-000000000001', 'BAD-CODE', null,
    'raw-ip-address', null
  )$$,
  '22023', 'invalid gateway fingerprint',
  'gateway rejects raw or malformed fingerprints'
);

insert into public.quest_access_gateway_attempts (key_type, key_hash, attempted_at, succeeded)
select 'network', repeat('a', 64), now() - interval '1 minute', false
from generate_series(1, 20);

select is(
  (select error_code from public.redeem_quest_access_code_from_gateway(
    '9a000000-0000-4000-8000-000000000001', 'BAD-CODE', null,
    repeat('a', 64), repeat('b', 64)
  )),
  'rate_limited',
  'network fingerprint is rate limited across accounts'
);
select ok(
  (select retry_after_seconds > 0 from public.redeem_quest_access_code_from_gateway(
    '9a000000-0000-4000-8000-000000000001', 'BAD-CODE', null,
    repeat('a', 64), repeat('b', 64)
  )),
  'gateway returns a retry delay'
);
select is(
  (select count(*) from public.quest_access_gateway_attempts where key_hash = repeat('a', 64)),
  20::bigint,
  'blocked requests do not grow the attempt table'
);
select is(
  (select count(*) from public.quest_access_gateway_attempts where key_hash = 'raw-ip-address'),
  0::bigint,
  'raw identifiers are never persisted'
);

select * from finish();
rollback;
