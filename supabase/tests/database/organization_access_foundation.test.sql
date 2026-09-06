begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('18000000-0000-4000-8000-000000000001', 'organization-owner-a@example.test', '{"username":"Owner A"}'::jsonb),
  ('18000000-0000-4000-8000-000000000002', 'organization-owner-b@example.test', '{"username":"Owner B"}'::jsonb);

select is(
  (select count(*) from public.organizations where personal_owner_id in (
    '18000000-0000-4000-8000-000000000001',
    '18000000-0000-4000-8000-000000000002'
  )),
  2::bigint,
  'a personal organization is provisioned for every new profile'
);

select is(
  (select count(*)
   from public.organization_memberships membership
   join public.organizations organization on organization.id = membership.organization_id
   where organization.personal_owner_id = membership.user_id
     and membership.status = 'active'
     and membership.user_id in (
       '18000000-0000-4000-8000-000000000001',
       '18000000-0000-4000-8000-000000000002'
     )),
  2::bigint,
  'personal organization owners receive active memberships'
);

select is(
  (select count(*)
   from public.membership_roles membership_role
   join public.organization_memberships membership on membership.id = membership_role.membership_id
   join public.roles role on role.id = membership_role.role_id
   where membership.user_id in (
       '18000000-0000-4000-8000-000000000001',
       '18000000-0000-4000-8000-000000000002'
     )
     and role.key = 'owner'),
  2::bigint,
  'personal organization owners receive the owner role'
);

insert into public.quests (id, creator_id, title)
values (
  '28000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000001',
  'Organization foundation quest'
);

select ok(
  (select organization_id is not null
   from public.quests
   where id = '28000000-0000-4000-8000-000000000001'),
  'legacy quest inserts receive the creator personal organization'
);

select is(
  (select organization_id
   from public.quests
   where id = '28000000-0000-4000-8000-000000000001'),
  (select id
   from public.organizations
   where personal_owner_id = '18000000-0000-4000-8000-000000000001'),
  'the assigned organization belongs to the quest creator'
);

select set_config(
  'app.test_owner_a_organization_id',
  (select id::text from public.organizations where personal_owner_id = '18000000-0000-4000-8000-000000000001'),
  true
);

select set_config(
  'app.test_owner_b_organization_id',
  (select id::text from public.organizations where personal_owner_id = '18000000-0000-4000-8000-000000000002'),
  true
);

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select ok(
  public.has_organization_permission(
    current_setting('app.test_owner_a_organization_id')::uuid,
    'quests.update'
  ),
  'an owner has quest update permission in their organization'
);

select is(
  (select count(*) from public.organizations),
  1::bigint,
  'RLS only exposes organizations of the current user'
);

select is(
  (select count(*) from public.organization_memberships),
  1::bigint,
  'RLS only exposes memberships of the current user'
);

select ok(
  not public.has_organization_permission(
    current_setting('app.test_owner_b_organization_id')::uuid,
    'quests.update'
  ),
  'an owner has no permission in another organization'
);

reset role;

update public.organization_memberships
set status = 'revoked'
where user_id = '18000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select ok(
  not public.has_organization_permission(
    current_setting('app.test_owner_a_organization_id')::uuid,
    'quests.update'
  ),
  'a revoked membership grants no permission'
);

reset role;
select * from finish();
rollback;
