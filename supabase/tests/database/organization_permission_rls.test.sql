begin;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('19000000-0000-4000-8000-000000000001', 'multi-owner@example.test', '{"username":"Multi owner"}'::jsonb),
  ('19000000-0000-4000-8000-000000000002', 'second-owner@example.test', '{"username":"Second owner"}'::jsonb),
  ('19000000-0000-4000-8000-000000000003', 'outsider-org@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.organization_memberships (organization_id, user_id, status)
select organization.id, '19000000-0000-4000-8000-000000000001', 'active'
from public.organizations organization
where organization.personal_owner_id = '19000000-0000-4000-8000-000000000002'
on conflict (organization_id, user_id) do update set status = 'active';

insert into public.membership_roles (membership_id, role_id)
select membership.id, role.id
from public.organization_memberships membership
join public.roles role on role.key = 'owner'
where membership.user_id = '19000000-0000-4000-8000-000000000001'
on conflict do nothing;

insert into public.quests (id, creator_id, organization_id, title, is_public)
values (
  '29000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000002',
  (select id from public.organizations where personal_owner_id = '19000000-0000-4000-8000-000000000002'),
  'Shared organization quest',
  false
);

insert into public.tasks (id, quest_id, title)
values (
  '39000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  'Shared organization task'
);

select set_config(
  'app.test_shared_organization_id',
  (select id::text from public.organizations where personal_owner_id = '19000000-0000-4000-8000-000000000002'),
  true
);

select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.organizations),
  2::bigint,
  'one user can own two organizations'
);

select ok(
  public.has_organization_permission(
    current_setting('app.test_shared_organization_id')::uuid,
    'quests.update'
  ),
  'the second owner membership grants permissions'
);

select is(
  (select count(*) from public.quests where id = '29000000-0000-4000-8000-000000000001'),
  1::bigint,
  'an owner can read a quest created by another owner of the organization'
);

select lives_ok(
  $$update public.quests set description = 'Updated by co-owner' where id = '29000000-0000-4000-8000-000000000001'$$,
  'an owner can update an organization quest regardless of creator_id'
);

select is(
  (select count(*) from public.tasks where quest_id = '29000000-0000-4000-8000-000000000001'),
  1::bigint,
  'an owner can read organization quest tasks'
);

select lives_ok(
  $$update public.tasks set hint = 'Owner hint' where id = '39000000-0000-4000-8000-000000000001'$$,
  'an owner can update organization quest tasks'
);

select throws_ok(
  $$select public.get_participant_tasks('29000000-0000-4000-8000-000000000001')$$,
  '42501',
  'quest access denied',
  'an organization role does not implicitly grant participant play access'
);

update public.quests set is_open = false
where id = '29000000-0000-4000-8000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select is(
  (select is_open from public.get_quest_entry_status('29000000-0000-4000-8000-000000000001')),
  false,
  'availability status is visible before participant access is evaluated'
);

select is(
  (select count(*) from public.quests where id = '29000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an outsider cannot read a private organization quest'
);

select is(
  (select count(*) from public.tasks where quest_id = '29000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an outsider cannot read private organization tasks directly'
);

select throws_ok(
  $$select public.get_participant_tasks('29000000-0000-4000-8000-000000000001')$$,
  '42501',
  'quest access denied',
  'an outsider cannot access private tasks through RPC'
);

select throws_ok(
  $$select public.start_quest_attempt('29000000-0000-4000-8000-000000000001')$$,
  '42501',
  'quest access denied',
  'an outsider cannot start a private organization quest'
);

select is(
  (select count(*) from public.profiles where id = '19000000-0000-4000-8000-000000000002'),
  0::bigint,
  'an outsider cannot read unrelated profiles'
);

reset role;
select * from finish();
rollback;
