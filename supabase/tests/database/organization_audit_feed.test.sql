begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('1f000000-0000-4000-8000-000000000001', 'audit-owner@example.test', '{"username":"Audit owner"}'::jsonb),
  ('1f000000-0000-4000-8000-000000000002', 'audit-outsider@example.test', '{"username":"Audit outsider"}'::jsonb);

select set_config(
  'app.test_audit_organization_id',
  (select id::text from public.organizations where personal_owner_id = '1f000000-0000-4000-8000-000000000001'),
  true
);

insert into public.participant_profiles (
  id, display_name, profile_kind, age_group, created_by_user_id
) values (
  '1f200000-0000-4000-8000-000000000001',
  'Участник аудита',
  'dependent',
  'child',
  '1f000000-0000-4000-8000-000000000001'
);

insert into public.organization_audit_events (
  organization_id, actor_user_id, participant_profile_id,
  action, entity_type, entity_id, metadata
) values (
  current_setting('app.test_audit_organization_id')::uuid,
  '1f000000-0000-4000-8000-000000000001',
  '1f200000-0000-4000-8000-000000000001',
  'invitation.created',
  'invitation',
  gen_random_uuid(),
  '{"safe":"value"}'::jsonb
);

select set_config('request.jwt.claim.sub', '1f000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.get_organization_audit_feed(current_setting('app.test_audit_organization_id')::uuid)),
  1::bigint,
  'owner can read organization audit feed'
);
select is(
  (select actor_username from public.get_organization_audit_feed(current_setting('app.test_audit_organization_id')::uuid) limit 1),
  'Audit owner',
  'audit feed resolves a display name'
);
select is(
  (select metadata ->> 'safe' from public.get_organization_audit_feed(current_setting('app.test_audit_organization_id')::uuid) limit 1),
  'value',
  'audit feed preserves safe metadata'
);
select is(
  (select participant_display_name from public.get_organization_audit_feed(current_setting('app.test_audit_organization_id')::uuid) limit 1),
  'Участник аудита',
  'audit feed resolves the participant display name for an authorized manager'
);
select is(
  (select metadata ? 'participant_profile_id' from public.get_organization_audit_feed(current_setting('app.test_audit_organization_id')::uuid) limit 1),
  false,
  'audit feed never exposes participant identifiers through metadata'
);
select is(
  (select count(*) from public.get_organization_audit_feed(current_setting('app.test_audit_organization_id')::uuid, 0)),
  1::bigint,
  'audit feed clamps the requested limit'
);

reset role;
select set_config('request.jwt.claim.sub', '1f000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select throws_ok(
  format(
    $$select * from public.get_organization_audit_feed(%L::uuid)$$,
    current_setting('app.test_audit_organization_id')
  ),
  '42501',
  'organization audit access denied',
  'outsider cannot read organization audit feed'
);

select * from finish();
rollback;
